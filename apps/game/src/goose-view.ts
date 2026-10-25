import { AnimationMixer, LoopRepeat, Mesh, SkinnedMesh } from 'three';
import type { AnimationAction } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { playerMovementScale, settings } from '@crossy/config';

export const goosePresentation = { scale: 0.9, referenceSpeed: 0.368, maxPlaybackRate: 3 * playerMovementScale, movingThreshold: 0.1 } as const;

/** Owns only visual resources and animation; never changes simulation state. */
export class GooseView {
  readonly model: GLTF['scene'];
  private readonly mixer: AnimationMixer;
  private readonly walk: AnimationAction;
  private moving = false;

  constructor(asset: GLTF) {
    const source = asset.animations.find(({ name }) => name === 'Goose_Walk');
    if (!source || !source.tracks.length || !asset.scene.getObjectByName('Goose_Root')) {
      throw new Error('Goose asset requires Goose_Root and Goose_Walk');
    }
    // Blender exported frame 1 at 1/24 s. Remove that leading hold from every
    // track, preserving the original endpoint and the intended one-second loop.
    const clip = source.clone();
    const start = Math.min(...clip.tracks.map((track) => track.times[0]!));
    for (const track of clip.tracks) track.shift(-start);
    clip.resetDuration();
    this.model = asset.scene;
    this.model.scale.setScalar(goosePresentation.scale);
    // Physics positions are capsule centres; Goose_Root is at the soles.
    this.model.position.y = -(settings.player.radius + settings.player.halfHeight);
    this.model.traverse((object) => {
      if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    this.mixer = new AnimationMixer(this.model);
    this.walk = this.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play();
    this.reset();
  }

  update(speed: number, elapsed: number, grounded: boolean, paused: boolean): void {
    if (paused) return;
    const moving = grounded && speed > goosePresentation.movingThreshold;
    if (!moving && this.moving) {
      // No idle clip exists. Return once to the double-support contact pose.
      this.walk.time = 0;
      this.mixer.update(0);
    }
    this.moving = moving;
    this.walk.paused = !moving;
    if (moving) {
      this.walk.timeScale = Math.min(speed / (goosePresentation.referenceSpeed * goosePresentation.scale), goosePresentation.maxPlaybackRate);
      this.mixer.update(elapsed);
    }
  }

  reset(): void {
    this.moving = false;
    this.walk.reset().play();
    this.mixer.update(0);
    this.walk.paused = true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    disposeGooseAsset(this.model);
    this.model.removeFromParent();
  }
}

export function disposeGooseAsset(model: GLTF['scene']): void {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<import('three').Material>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  model.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
