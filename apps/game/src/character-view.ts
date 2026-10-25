import { CharacterBatch } from './character-batch';
import { AnimationMixer, Box3, Group, Mesh } from 'three';
import type { AnimationAction, Material } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { playerMovementScale, riverSettings, settings } from '@crossy/config';
import type { CharacterDefinition } from './character-assets';
import { GooseView, disposeGooseAsset } from './goose-view';

const base = settings.player.radius + settings.player.halfHeight;
const transition = .22;
/** Separate authored skins are intentional: capybara swim has four additional bones.
 * Crossfade their original material opacity, never retarget clips onto an incompatible rig. */
export class CharacterView {
  readonly model = new Group();
  readonly height: number;
  readonly triangles: number;
  private readonly waterHeight: number;
  get labelHeight(): number { return (1-this.waterBlend)*this.height + this.waterBlend*this.waterHeight + this.land.scene.position.y + base + .32; }
  private readonly landBatch: CharacterBatch;
  private readonly waterBatch: CharacterBatch;
  private readonly landMixer: AnimationMixer | undefined;
  private readonly goose: GooseView | undefined;
  private readonly waterMixer: AnimationMixer;
  private readonly walk: AnimationAction | undefined;
  private readonly neutral: AnimationAction | undefined;
  private readonly swim: AnimationAction;
  private readonly tread: AnimationAction;
  private readonly materials: { material: Material; opacity: number; transparent: boolean; depthWrite: boolean; water: boolean }[] = [];
  private waterBlend = 0;
  private moving = false;
  private waterMoving = false;
  private rate = 0;
  private water = false;
  private disposed = false;
  private initialized = false;
  constructor(private readonly land: GLTF, private readonly swimming: GLTF, readonly definition: CharacterDefinition) {
    const clip = (asset: GLTF, name: string) => {
      const source = asset.animations.find(c => c.name === name);
      if (!source?.tracks.length || !asset.scene.getObjectByName(definition.root)) throw new Error(`${definition.species}: missing ${name} or ${definition.root}`);
      const c = source.clone(), start = Math.min(...c.tracks.map(t => t.times[0]!));
      for (const track of c.tracks) {
        // Root anchors must be stationary. Animated body/limb bob is retained.
        if (track.name.startsWith(`${definition.root}.`)) {
          const width = track.getValueSize();
          for (let i = width; i < track.values.length; i++) track.values[i] = track.values[i % width]!;
        }
        track.shift(-start);
      }
      c.resetDuration(); return c;
    };
    const walkClip = clip(land, definition.walk);
    const swimClip = clip(swimming, definition.swim), treadClip = clip(swimming, definition.tread);
    if (definition.root === 'Goose_Root') this.goose = new GooseView(land);
    else {
      this.landMixer = new AnimationMixer(land.scene);
      this.walk = this.landMixer.clipAction(walkClip).play();
      const neutral = walkClip.clone(); neutral.name += '_contact';
      // Hold the existing authored contact pose; no new animation is authored.
      for (const track of neutral.tracks) { track.times = new Float32Array([0]); track.values = track.values.slice(0, track.getValueSize()); }
      neutral.duration = 1;
      this.neutral = this.landMixer.clipAction(neutral).play();
      this.walk.setEffectiveWeight(0);
    }
    this.waterMixer = new AnimationMixer(swimming.scene);
    this.swim = this.waterMixer.clipAction(swimClip).play().setEffectiveWeight(0);
    this.tread = this.waterMixer.clipAction(treadClip).play();
    let triangles = 0;
    for (const [asset, water] of [[land, false], [swimming, true]] as const) {
      asset.scene.scale.setScalar(definition.scale); asset.scene.position.y = -base;
      asset.scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        if (!water) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!this.materials.some(m => m.material === material)) this.materials.push({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite, water });
        }
      });
      this.model.add(asset.scene);
    }
    this.triangles = triangles;
    land.scene.updateMatrixWorld(true);
    this.height = new Box3().setFromObject(land.scene, true).max.y;
    swimming.scene.updateMatrixWorld(true);
    this.waterHeight = new Box3().setFromObject(swimming.scene, true).max.y;
    this.landBatch = new CharacterBatch(land.scene);
    this.waterBatch = new CharacterBatch(swimming.scene);
    this.reset();
  }
  setWater(water: boolean): void { this.water = water; }
  update(speed: number, elapsed: number, grounded: boolean, paused: boolean, centreY: number): void {
    if (this.disposed || paused && this.initialized) return;
    if (!this.initialized) { this.waterBlend = this.water ? 1 : 0; this.initialized = true; }
    const dt = paused ? 0 : Math.min(.1, Math.max(0, elapsed));
    const moving = grounded && speed > (this.moving ? .065 : .12);
    if (moving !== this.moving) {
      this.moving = moving;
      if (this.walk && this.neutral) {
        const to = moving ? this.walk : this.neutral, from = moving ? this.neutral : this.walk;
        to.enabled = true; to.setEffectiveWeight(1).play(); from.crossFadeTo(to, transition, false);
      }
    }
    this.rate += (Math.min(3 * playerMovementScale, speed / (this.definition.landSpeed * this.definition.scale)) - this.rate) * (1 - Math.exp(-12 * dt));
    if (this.walk) this.walk.timeScale = this.rate;
    if (this.waterBlend < 1) this.goose?.update(moving ? Math.max(.101, speed) : 0, dt, grounded, false);
    const waterMoving = speed > (this.waterMoving ? .065 : .12);
    if (waterMoving !== this.waterMoving) {
      this.waterMoving = waterMoving;
      const to = waterMoving ? this.swim : this.tread, from = waterMoving ? this.tread : this.swim;
      to.enabled = true; to.setEffectiveWeight(1).play(); from.crossFadeTo(to, transition, false);
    }
    this.swim.timeScale = Math.max(.65, Math.min(3 * playerMovementScale, speed / (this.definition.swimSpeed * this.definition.scale)));
    this.waterBlend += Math.max(-dt / transition, Math.min(dt / transition, (this.water ? 1 : 0) - this.waterBlend));
    const w = this.waterBlend;
    this.land.scene.visible = w < 1; this.swimming.scene.visible = w > 0;
    // World waterline alignment is presentation only, independent of collider depth.
    const y = -base * (1 - w) + (riverSettings.surfaceY - this.definition.waterline * this.definition.scale - centreY) * w;
    this.land.scene.position.y = this.swimming.scene.position.y = y;
    for (const m of this.materials) {
      const alpha = m.water ? w : 1 - w, fading = alpha > 0 && alpha < 1;
      if (m.material.transparent !== (m.transparent || fading)) { m.material.transparent = m.transparent || fading; m.material.needsUpdate = true; }
      m.material.opacity = m.opacity * alpha; m.material.depthWrite = fading ? false : m.depthWrite;
    }
    if (w < 1) this.landMixer?.update(dt);
    if (w > 0) this.waterMixer.update(dt);
    if (w < 1) this.landBatch.update();
    if (w > 0) this.waterBatch.update();
  }
  reset(): void {
    this.initialized = false;
    this.moving = this.waterMoving = this.water = false; this.waterBlend = this.rate = 0;
    this.goose?.reset();
    this.landMixer?.stopAllAction(); this.waterMixer.stopAllAction();
    this.walk?.reset().play().setEffectiveWeight(0); this.neutral?.reset().play().setEffectiveWeight(1);
    this.swim.reset().play().setEffectiveWeight(0); this.tread.reset().play().setEffectiveWeight(1);
    this.landMixer?.update(0); this.waterMixer.update(0);
    this.landBatch?.update(); this.waterBatch?.update();
    this.land.scene.visible = true; this.swimming.scene.visible = false;
    this.land.scene.position.y = this.swimming.scene.position.y = -base;
    for (const m of this.materials) { m.material.opacity = m.opacity; m.material.transparent = m.transparent; m.material.depthWrite = m.depthWrite; m.material.needsUpdate = true; }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.landMixer?.stopAllAction(); this.landMixer?.uncacheRoot(this.land.scene);
    this.waterMixer.stopAllAction(); this.waterMixer.uncacheRoot(this.swimming.scene);
    if (this.goose) this.goose.dispose(); else disposeGooseAsset(this.land.scene);
    disposeGooseAsset(this.swimming.scene); this.model.removeFromParent();
  }
}
