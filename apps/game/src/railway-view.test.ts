import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { railwaySettings as rail } from '@crossy/config';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { SnapshotBuffer } from './snapshot-buffer';
import { batchStaticCar } from './static-car';
import { disposeTraffic } from './traffic-view';
import { RailwayView } from './railway-view';
import { railwayFeedback } from './railway-feedback';
beforeAll(initializePhysics);
it('loads exact existing modules: metre scale, pivots, 7108 triangles, preserved materials, collider-aligned reusable batches',async()=>{
 const assembly=new Group();assembly.rotation.y=Math.PI/2;assembly.position.set(0,0,rail.z);
 let triangles=0,drawsBefore=0,drawsAfter=0;
 try{
  for(const m of rail.modules){
   const b=readFileSync(new URL(`../../../assets/train/output/train_004/${m.name}.glb`,import.meta.url));
   const asset=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
   const batch=batchStaticCar(asset.scene);
   try{
    const bounds=new Box3().setFromObject(asset.scene),size=bounds.getSize(new Vector3());
    expect(size.x).toBeCloseTo(m.width);expect(size.y).toBeCloseTo(m.height);expect(size.z).toBeCloseTo(m.length);expect(bounds.min.y).toBeCloseTo(0);
    expect(asset.animations).toHaveLength(0);
    const front=asset.scene.getObjectByName(`Train_${m.name==='open_wagon'?'OpenWagon':m.name==='locomotive'?'Locomotive':'Boxcar'}_Attach_Front`)!;
    expect(front.getWorldPosition(new Vector3()).z).toBeCloseTo(m.length/2);
    asset.scene.traverse(o=>{if(o instanceof Mesh)drawsBefore++;});
    batch.traverse(o=>{if(o instanceof Mesh){drawsAfter++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position!.count)/3;expect(o.material).not.toBeInstanceOf(Array);}});
    const batchedBounds=new Box3().setFromObject(batch);expect(batchedBounds.min.distanceTo(bounds.min)).toBeLessThan(1e-5);expect(batchedBounds.max.distanceTo(bounds.max)).toBeLessThan(1e-5);
    const moduleGroup=new Group();moduleGroup.position.z=m.offset;moduleGroup.add(batch);assembly.add(moduleGroup);
   }finally{disposeTraffic(asset.scene);}
  }
  expect(triangles).toBe(7108);expect(drawsAfter).toBe(26);expect(drawsBefore).toBeGreaterThan(drawsAfter);
  const bounds=new Box3().setFromObject(assembly);expect(bounds.max.x).toBeCloseTo(3.18);expect(bounds.min.x).toBeCloseTo(-12.5);expect(bounds.min.z).toBeCloseTo(rail.z-1.15);expect(bounds.max.z).toBeCloseTo(rail.z+1.15);
 }finally{disposeTraffic(assembly);}
});
it('interpolates trains with the assembly, holds on underrun, never sweeps recycle, snaps terminal and clears restart history',()=>{
 const s=new AuthoritativeSession('railway');
 try{
  const a=s.snapshot(1000),b=structuredClone(a);b.tick++;b.serverTimeMs=1100;
  a.railway!.x=-2;b.railway!.x=2;b.players[0]!.position.x+=2;b.chain!.segments[0]!.position.x+=2;
  const buffer=new SnapshotBuffer(0);buffer.push(a,1000);buffer.push(b,1100);const mid=buffer.sample(1050)!;
  expect(mid.railway!.x).toBe(0);expect(mid.players[0]!.position.x).toBe(a.players[0]!.position.x+1);expect(mid.chain!.segments[0]!.position.x).toBe(a.chain!.segments[0]!.position.x+1);
  expect(buffer.sample(9999)!.railway!.x).toBe(2);
  const wrap=structuredClone(b);wrap.tick++;wrap.serverTimeMs=1200;wrap.railway!.pass++;wrap.railway!.x=-36;buffer.push(wrap,1200);expect(buffer.sample(1150)!.railway!.x).toBe(2);
  const end=structuredClone(wrap);end.tick++;end.serverTimeMs=1300;end.phase='ended';end.railway!.outcome='failed';end.railway!.dead=['p2'];buffer.push(end,1300);
  expect(buffer.sample(1300)!.railway).toEqual(end.railway);expect(buffer.sample(1300)!.players).toEqual(end.players);expect(railwayFeedback(end.railway!)).toContain('P2');
  s.reset();buffer.push(s.snapshot(1400),1400);expect(buffer.size).toBe(1);expect(buffer.sample(1400)!.railway!.x).toBe(-36);
 }finally{s.dispose();}
});
it('owns simple reusable visual resources and lamp changes without moving gameplay bodies',()=>{
 const view=new RailwayView();try{
  view.update({elapsedSeconds:10,pass:0,x:-36,signal:'warning',dead:[],outcome:'active'});expect(view.train.position.x).toBe(-36);expect(view.train.rotation.y).toBe(Math.PI/2);expect(view.train.children).toHaveLength(3);
  view.update({elapsedSeconds:16,pass:0,x:-8,signal:'occupying',dead:[],outcome:'active'});expect(view.train.position.x).toBe(-8);
 }finally{view.dispose();}expect(view.group.children).toHaveLength(0);
});

it('loads modular assets once across resets and safely disposes a late load',async()=>{
 const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const name=rail.modules.find(m=>url.includes(m.name))!.name;
  const b=readFileSync(new URL(`../../../assets/train/output/train_004/${name}.glb`,import.meta.url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 });
 const view=new RailwayView(),late=new RailwayView();
 try{
  await view.load();await view.load();expect(load).toHaveBeenCalledTimes(3);
  expect(view.train.children).toHaveLength(3);expect(view.train.position.y).toBe(rail.railTopY);
  expect(view.train.children.reduce((n,g)=>n+g.children.length,0)).toBe(26);
  const pending=late.load();late.dispose();await pending;expect(late.group.children).toHaveLength(0);
 }finally{view.dispose();late.dispose();load.mockRestore();}
});
