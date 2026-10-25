import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { Box3, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateSection, sectionBoxes, groupScenario, generatedScenario, sectionCenter, roadLanes, riverSettings, generatedSettings } from '@crossy/config';
import { initializePhysics, FoundationSimulation } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { GeneratedWorldView } from './generated-world-view';
import { RailwayView, presentTrain, extendRailway } from './railway-view';
import { railwayPose } from '@crossy/simulation';
import { TrafficView } from './traffic-view';
beforeAll(initializePhysics);
function assets(){return vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
 const tree=['tree_small','tree_medium','tree_tall'].find(n=>url.includes(n));
 const rock=['rock_small','rock_medium'].find(n=>url.includes(n));
 const name=['locomotive','boxcar','open_wagon'].find(n=>url.includes(n));
 const b=readFileSync(new URL(tree?`../../../assets/trees/output/trees_005/${tree}.glb`:rock?`../../../assets/rocks/output/rocks_001/${rock}.glb`:name?`../../../assets/train/output/train_004/${name}.glb`:'../../../assets/car/output/car_001/car.glb',import.meta.url));
 return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
});}
it('extends original ground/slopes, asphalt, paint, water and railbed at matching heights; retires walls visually only',async()=>{
 const load=assets(),session=new AuthoritativeSession('generated',4,42),v=new GeneratedWorldView();
 try{
  const w=session.snapshot(0).world!,before=structuredClone(w),colliders=session.simulation.world.colliders.len();
  v.update(w);await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(9));await new Promise(r=>setTimeout(r,25));v.refresh();
  v.setVisualHalfWidth(160);
  for(const type of ['grass','road','river','railway'] as const){
   const section={...generateSection(42,type==='railway'?3:1),type};
   const world={...w,sections:[section],hazards:[]};v.reset();v.update(world);
   const root=v.group.children[0]!;
   const ground=root.children.filter(o=>o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.color.getHex()===generatedSettings.grassColor) as Mesh[];
   const boxes=sectionBoxes(section).filter(b=>b.kind==='ground');expect(ground).toHaveLength(boxes.length);
   for(const [i,m] of ground.entries()){
    expect(m.position.toArray()).toEqual([boxes[i]!.center.x,boxes[i]!.center.y,boxes[i]!.center.z]);expect(m.rotation.x).toBe(boxes[i]!.rotationX??0);
    expect(m.scale.x).toBe(320);const bounds=new Box3().setFromObject(m);expect(bounds.min.x).toBe(-160);expect(bounds.max.x).toBe(160);
   }
   expect(root.children.some(o=>o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.color.getHex()===0x38645e)).toBe(false);
   if(type==='river'){
    const water=root.children.find(o=>o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.color.getHex()===0x247faf) as Mesh;
    expect(water.position.y).toBe(riverSettings.surfaceY);expect(water.scale.x).toBe(320);expect(water.position.z).toBe(sectionCenter(section));
   }
   if(type==='road'){
    const asphalt=root.children.find(o=>o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.color.getHex()===0x34444a) as Mesh;
    expect(asphalt.scale.x).toBe(320);expect(asphalt.scale.z).toBe(roadLanes(section).length*generatedSettings.lanePitch);
   }
  }
  expect(w).toEqual(before);expect(session.simulation.world.colliders.len()).toBe(colliders);
 }finally{v.dispose();session.dispose();load.mockRestore();}
});
it('keeps bounded shared batches and releases streamed sections, buffers and signal materials across resize/restart/reclaim',async()=>{
 const load=assets(),session=new AuthoritativeSession('generated',4,1),v=new GeneratedWorldView();
 try{
  const w=session.snapshot(0).world!;v.update(w);await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(9));await new Promise(r=>setTimeout(r,25));v.refresh();
  for(const width of [24,48,160]){v.setVisualHalfWidth(width);v.group.traverse(o=>{if(o instanceof InstancedMesh)expect(o.count).toBeLessThanOrEqual(o.instanceMatrix.count);});}
  const counts=()=>{let meshes=0,instances=0;v.group.traverse(o=>{if(o instanceof Mesh)meshes++;if(o instanceof InstancedMesh){instances+=o.count;expect(o.count).toBeLessThanOrEqual(o.instanceMatrix.count);}});return {meshes,instances};};
  const baseline=counts();expect(baseline.meshes).toBeLessThan(600);
  for(let i=0;i<10;i++){
   const buffers:ReturnType<typeof vi.spyOn>[]=[];v.group.traverse(o=>{if(o instanceof InstancedMesh)buffers.push(vi.spyOn(o,'dispose'));});
   v.update({...w,sections:[],hazards:[]});expect(v.group.children).toHaveLength(0);expect(buffers.every(b=>b.mock.calls.length===1)).toBe(true);
   // Full authority descriptors reconstruct the same view, as on reclaim.
   v.update(structuredClone(w));expect(counts()).toEqual(baseline);
   session.reset();expect(session.snapshot(0).world).toEqual(w);
  }
  expect(load).toHaveBeenCalledTimes(9);
 }finally{v.dispose();session.dispose();load.mockRestore();}
});
it.each([2,3,4] as const)('%i physical seats remain inside original invisible walls under sustained drive in both directions',capacity=>{
 const s=groupScenario(generatedScenario,capacity),boxes=sectionBoxes(generateSection(42,0,capacity));
 const sim=new FoundationSimulation(s.players,boxes,true);
 try{
  const colliders=sim.world.colliders.len(),bodies=sim.world.bodies.len();
  for(const sign of [-1,1]){
   sim.reset();
   for(let tick=0;tick<600;tick++){
    sim.step(Object.fromEntries(s.players.map(p=>[p.id,{x:sign,z:0}])));
    expect(sim.states().every(p=>Math.abs(p.position.x)<9.4)).toBe(true);
   }
   expect(sim.fault).toBeUndefined();expect(sim.chainMetricsAll().every(m=>m.excessRatio<.05)).toBe(true);
   expect(sim.world.colliders.len()).toBe(colliders);expect(sim.world.bodies.len()).toBe(bodies);
  }
 }finally{sim.dispose();}
},20000);
it('renders complete train copies beyond dwell/reset and keeps rail/sleeper endpoints outside the coverage corridor',()=>{
 const v=new RailwayView();try{
  extendRailway(v.group,160);
  for(const o of v.group.children)if(o instanceof Mesh&&o.userData.continuation==='rail')expect(new Box3().setFromObject(o).max.x).toBe(160);
  const ties=v.group.children.find(o=>o.userData.continuation==='ties') as InstancedMesh;expect(ties.count).toBe(320);
  for(const t of [0,3,4.59,4.6,6.99,7,10]){
   const state={...railwayPose(t),elapsedSeconds:t,dead:[],outcome:'active' as const};presentTrain(v.group,v.train,state,1,160);
   expect(v.train.position.x).toBe(state.x);
   const first=v.group.children.length;for(let i=0;i<20;i++)presentTrain(v.group,v.train,state,1,160);expect(v.group.children.length).toBe(first);
  }
 }finally{v.dispose();}
});
it('retains handcrafted car roots at authoritative positions while periodic images cross outside both sides',async()=>{
 const load=assets(),v=new TrafficView();try{
  await v.load();v.setVisualHalfWidth(160);
  for(const x of [-17.99,17.99,-18,18]){
   const state={elapsedSeconds:0,dead:[],outcome:'active' as const,vehicles:[{id:0,lane:0,x}]};v.update(state);
   expect(v.group.children[0]!.position.x).toBe(x);
   expect(v.group.children.length).toBeLessThan(18);
  }
 }finally{v.dispose();load.mockRestore();}
});
