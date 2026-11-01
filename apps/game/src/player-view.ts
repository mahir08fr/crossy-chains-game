import { waterRing } from './water-ring';
import type { MotionRiver } from '@crossy/protocol';
import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';
import { settings } from '@crossy/config';
import type { Point3 } from '@crossy/config';
import { CharacterView } from './character-view';
import type { CharacterDefinition } from './character-assets';
import { GooseView, disposeGooseAsset } from './goose-view';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export class PlayerView {
  readonly group = new Group();
  private facing = 0;
  private readonly placeholder = new Group();
  private goose: GooseView | undefined;
  private character: CharacterView | undefined;
  get labelHeight(): number { return this.character?.labelHeight ?? 1.42; }
  get characterTriangles(): number { return this.character?.triangles ?? 0; }
  useCharacter(land: GLTF, water: GLTF, definition: CharacterDefinition): void {
    const view = new CharacterView(land, water, definition);
    this.character?.dispose(); this.goose?.dispose(); this.goose = undefined;
    this.character = view; this.group.add(view.model); this.placeholder.visible = false;
  }

  constructor(color: number) {
    this.group.add(this.placeholder);
    const body = new Mesh(
      new CapsuleGeometry(settings.player.radius, settings.player.halfHeight * 2, 6, 12),
      new MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    body.castShadow = true;
    this.placeholder.add(body);
    const eyeMaterial = new MeshStandardMaterial({ color: 0x17343a });
    const eyeGeometry = new SphereGeometry(0.055, 8, 6);
    for (const x of [-0.12, 0.12]) {
      const eye = new Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(x, 0.34, 0.31);
      this.placeholder.add(eye);
    }
    const band = new Mesh(new TorusGeometry(0.355, 0.035, 5, 20), new MeshStandardMaterial({ color: 0xe28742 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.1;
    this.placeholder.add(band);
  }

  useGoose(asset: GLTF): void {
    this.goose = new GooseView(asset);
    this.group.add(this.goose.model);
    this.placeholder.visible = false;
  }

  setDead(dead: boolean): void {
    let marker = this.group.getObjectByName('death-marker');
    if (!marker && dead) {
      marker = new Mesh(new TorusGeometry(0.6, 0.10, 6, 24), new MeshStandardMaterial({ color: 0xff3028, emissive: 0x661008 }));
      marker.name = 'death-marker'; marker.rotation.x = Math.PI / 2; marker.position.y = -0.5; this.group.add(marker);
    }
    if (marker) marker.visible = dead;
  }

  private waterMarker: Mesh<BufferGeometry,MeshBasicMaterial> | undefined;
  private lastRemaining = -1;
  setWater(state: MotionRiver['players'][number] | undefined, limit = 8): void {
    this.character?.setWater(!!state && ['entering','endangered','failed'].includes(state.phase));
    const ring = waterRing(state,limit);
    // A full red death torus would look like a refilled survival timer at drowning.
    if(state?.phase==='failed'){const death=this.group.getObjectByName('death-marker');if(death)death.visible=false;}
    if (!this.waterMarker && ring.visible) {
      // Fixed buffer, continuous endpoint. No per-frame geometry allocation or wall-clock drain.
      const geometry = new BufferGeometry();
      geometry.setAttribute('position',new BufferAttribute(new Float32Array(96*6*3),3));
      this.waterMarker=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide,depthTest:false,transparent:true}));
      this.waterMarker.name='water-marker';this.waterMarker.renderOrder=10;this.waterMarker.frustumCulled=false;
      this.waterMarker.position.y=.1;this.group.add(this.waterMarker);
    }
    const marker=this.waterMarker;if(!marker)return;
    marker.visible=ring.visible;marker.material.color.setHex(ring.color);
    if(this.lastRemaining!==ring.remaining){
      const p=marker.geometry.getAttribute('position') as BufferAttribute;
      // Start at world +Z; clockwise depletion removes from the leading endpoint.
      const start=(1-ring.remaining)*Math.PI*2;
      for(let i=0;i<96;i++){
        const a=start+ring.remaining*Math.PI*2*i/96,b=start+ring.remaining*Math.PI*2*(i+1)/96;
        for(const [j,angle,r] of [[0,a,.59],[1,a,.71],[2,b,.71],[3,a,.59],[4,b,.71],[5,b,.59]])p.setXYZ(i*6+j!,Math.sin(angle!)*r!,0,Math.cos(angle!)*r!);
      }
      p.needsUpdate=true;marker.geometry.setDrawRange(0,ring.remaining>0?96*6:0);this.lastRemaining=ring.remaining;
    }
  }
  setDanger(danger: boolean): void { this.setWater(danger?{id:'p1',phase:'endangered',exposureSeconds:0,safeSeconds:0}:undefined); }

  update(position: Point3, velocity: Point3, elapsed: number, grounded = true, paused = false): void {
    this.group.position.set(position.x, position.y, position.z);
    const speed = Math.hypot(velocity.x, velocity.z);
    if (!paused && speed > 0.1) {
      const desired = Math.atan2(velocity.x, velocity.z);
      const delta = Math.atan2(Math.sin(desired - this.facing), Math.cos(desired - this.facing));
      this.facing += delta * (1 - Math.exp(-15 * elapsed));
    }
    this.group.rotation.y = this.facing;
    if(this.waterMarker)this.waterMarker.rotation.y=-this.facing;
    this.goose?.update(speed, elapsed, grounded, paused);
    this.character?.update(speed, elapsed, grounded, paused, position.y);
  }

  reset(): void { this.setDead(false); this.setDanger(false); this.facing = 0; this.group.rotation.y = 0; this.goose?.reset(); this.character?.reset(); }

  dispose(): void { this.character?.dispose(); this.goose?.dispose(); disposeGooseAsset(this.group); this.group.removeFromParent(); }
}
