import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roadScenario } from '@crossy/config';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { SnapshotBuffer } from './snapshot-buffer';
import { batchStaticCar } from './static-car';
import { disposeTraffic } from './traffic-view';
import { createWorldView } from './world-view';
beforeAll(initializePhysics);
it('loads preserved GLB with expected geometry, pivot, matte materials, direction and no animation', async () => {
  const b = readFileSync(new URL('../../../assets/car/output/car_001/car.glb', import.meta.url));
  const asset = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  try {
    const bounds = new Box3().setFromObject(asset.scene), size = bounds.getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.72); expect(size.y).toBeCloseTo(1.5); expect(size.z).toBeCloseTo(3.54);
    expect(bounds.min.y).toBeCloseTo(0); expect(asset.animations).toHaveLength(0);
    expect(asset.scene.getObjectByName('Car_Root')!.position.length()).toBe(0);
    expect(asset.scene.getObjectByName('Car_Bumper_Front')!.getWorldPosition(new Vector3()).z).toBeGreaterThan(1.6);
    let triangles = 0;
    asset.scene.traverse(o => { if (o instanceof Mesh) {
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position!.count) / 3;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        expect(material.transparent).toBe(false); expect(material.roughness).toBeCloseTo(0.87); expect(material.metalness).toBe(0);
      }
    } });
    expect(triangles).toBe(2972);
  } finally { disposeTraffic(asset.scene); }
});
it('interpolates traffic wrap offscreen on shared timeline and presents atomic terminal state', () => {
  const session = new AuthoritativeSession('road');
  try {
    const a = session.snapshot(1000), b = structuredClone(a); b.serverTimeMs = 1100; b.tick = 1;
    a.road!.vehicles[0]!.x = 17.8; b.road!.vehicles[0]!.x = -17.8;
    a.players[0]!.position.x = 0; b.players[0]!.position.x = 2;
    a.chain!.segments[0]!.position.x = 0; b.chain!.segments[0]!.position.x = 2;
    const buffer = new SnapshotBuffer(50); buffer.push(a, 1000); buffer.push(b, 1100);
    const midway = buffer.sample(1100)!;
    expect(Math.abs(midway.road!.vehicles[0]!.x)).toBeCloseTo(18);
    expect(midway.players[0]!.position.x).toBe(1); expect(midway.chain!.segments[0]!.position.x).toBe(1);
    const end = structuredClone(b); end.tick = 2; end.serverTimeMs = 1150; end.phase = 'ended'; end.road!.outcome = 'failed'; end.road!.dead = ['p1'];
    buffer.push(end, 1150); const terminal = buffer.sample(1150)!;
    expect(terminal.players).toEqual(end.players); expect(terminal.chain).toEqual(end.chain); expect(terminal.road).toEqual(end.road);
    session.reset(); buffer.push(session.snapshot(1200), 1200);
    expect(buffer.size).toBe(1); expect(buffer.sample(1200)!.road!.dead).toEqual([]);
  } finally { session.dispose(); }
});
it('creates road markings from simple geometry without modifying collider descriptions', () => {
  const original = structuredClone(roadScenario), view = createWorldView(roadScenario);
  try { expect(view.children.length).toBeGreaterThan(25); expect(roadScenario).toEqual(original); }
  finally { disposeTraffic(view); }
});

it('batches the actual static car by material without changing shape, triangles or source nodes', async () => {
  const b = readFileSync(new URL('../../../assets/car/output/car_001/car.glb', import.meta.url));
  const asset = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const sourceCount = asset.scene.children.length;
  const batched = batchStaticCar(asset.scene);
  try {
    expect(batched.children).toHaveLength(9);
    expect(asset.scene.children).toHaveLength(sourceCount);
    const original = new Box3().setFromObject(asset.scene), bounds = new Box3().setFromObject(batched);
    expect(bounds.min.distanceTo(original.min)).toBeLessThan(1e-5);
    expect(bounds.max.distanceTo(original.max)).toBeLessThan(1e-5);
    let triangles = 0;
    batched.traverse(o => { if (o instanceof Mesh) triangles += (o.geometry.index?.count ?? o.geometry.attributes.position!.count) / 3; });
    expect(triangles).toBe(2972);
  } finally { disposeTraffic(batched); disposeTraffic(asset.scene); }
});
