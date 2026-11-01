import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { scenarios } from '@crossy/config';
import { GooseView, goosePresentation, disposeGooseAsset } from './goose-view';
import { PlayerView } from './player-view';

const bytes = readFileSync(new URL('../../../assets/goose/output/goose_animated/canada_goose_animated.glb', import.meta.url));
const load = (): Promise<GLTF> => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const footPosition = (asset: GLTF) => {
  asset.scene.updateMatrixWorld(true);
  return asset.scene.getObjectByName('Goose_WebbedFoot_L')!.getWorldPosition(new Vector3());
};

beforeAll(initializePhysics);

it('loads the actual self-contained asset with feet pivot, +Z forward, skin and named loop', async () => {
  const asset = await load();
  let meshes = 0;
  asset.scene.traverse((object) => { if (object instanceof Mesh) meshes++; });
  // glTF's 26 authored meshes become 103 material primitives in Three.js.
  expect(meshes).toBe(103);
  asset.scene.updateMatrixWorld(true);
  expect(asset.scene.getObjectByName('Goose_Root')!.position.length()).toBe(0);
  expect(asset.scene.getObjectByName('Goose_Beak')!.getWorldPosition(new Vector3()).z).toBeGreaterThan(0.8);
  expect(asset.animations.map(({ name }) => name)).toEqual(['Goose_Walk']);
  expect(asset.scene.getObjectByName('Goose_Root')!.userData.walk_speed_mps).toBe(0.368);
  const view = new GooseView(asset);
  try {
    const bounds = new Box3().setFromObject(view.model, true);
    expect(bounds.min.y).toBeCloseTo(-0.77, 5);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.703, 2);
    // The source is cloned before normalization; original keys remain intact.
    expect(asset.animations[0]!.tracks[0]!.times[0]).toBeCloseTo(1 / 24);
  } finally { view.dispose(); }
});

it('advances continuously at measured speed, caps fast motion, loops in one second and plants idle feet', async () => {
  const asset = await load();
  const view = new GooseView(asset);
  try {
    const start = footPosition(asset);
    const reference = goosePresentation.referenceSpeed * goosePresentation.scale;
    for (let i = 0; i < 5; i++) view.update(reference, 0.05, true, false);
    const quarter = footPosition(asset);
    expect(quarter.distanceTo(start)).toBeGreaterThan(0.02);
    view.update(reference, 0.25, true, false);
    expect(footPosition(asset).distanceTo(quarter)).toBeGreaterThan(0.02);
    view.update(reference, 0.5, true, false);
    expect(footPosition(asset).distanceTo(start)).toBeLessThan(1e-5);
    view.update(5, .25 / goosePresentation.maxPlaybackRate, true, false);
    expect(footPosition(asset).distanceTo(quarter)).toBeLessThan(1e-5);
    const pausedPose = footPosition(asset);
    view.update(5, 0.3, true, true);
    expect(footPosition(asset).distanceTo(pausedPose)).toBe(0);
    view.update(0, 0.1, true, false);
    expect(footPosition(asset).distanceTo(start)).toBeLessThan(1e-5);
    view.update(5, 0.1, false, false);
    expect(footPosition(asset).distanceTo(start)).toBeLessThan(1e-5);
    view.update(reference, 0.1, true, false);
    view.reset();
    expect(footPosition(asset).distanceTo(start)).toBeLessThan(1e-5);
  } finally { view.dispose(); }
});

it('keeps soles above the capsule base throughout the cycle and preserves the physics attachment while turning', async () => {
  const asset = await load();
  const player = new PlayerView(0xf4bd62);
  player.useGoose(asset);
  try {
    const scenario = scenarios.find(({ id }) => id === 'slack')!;
    const sim = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain);
    try {
      for (let i = 0; i < 120; i++) sim.step({ p1: { x: 0.2, z: 0.1 } });
      const state = sim.states()[0]!;
      const original = sim.states();
      for (let i = 0; i < 100; i++) {
        player.update(state.position, { x: 0.368 * 0.9, y: 0, z: 0 }, 0.01, true, false);
        player.group.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(asset.scene, true);
        expect(bounds.min.y).toBeGreaterThanOrEqual(state.position.y - settings.player.radius - settings.player.halfHeight - 1e-6);
        expect(player.group.position.toArray()).toEqual([state.position.x, state.position.y, state.position.z]);
      }
      expect(player.group.rotation.y).toBeCloseTo(Math.PI / 2, 4);
      expect(sim.states()).toEqual(original);
      player.reset();
      expect(player.group.rotation.y).toBe(0);
    } finally { sim.dispose(); }
  } finally { player.dispose(); }
});

it('retains the visible placeholder when an invalid animation asset is rejected', async () => {
  const asset = await load();
  asset.animations = [];
  const player = new PlayerView(0xf4bd62);
  expect(() => player.useGoose(asset)).toThrow('Goose asset requires');
  expect(player.group.children[0]!.visible).toBe(true);
  expect(player.group.children).toHaveLength(1);
  disposeGooseAsset(asset.scene);
});
