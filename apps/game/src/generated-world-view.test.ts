import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { InstancedMesh, Matrix4, Vector3, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generatedSettings, generatedVehicleSlots, roadLanes } from '@crossy/config';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { GeneratedWorldView } from './generated-world-view';
import { TrafficView } from './traffic-view';
import { SnapshotBuffer } from './snapshot-buffer';
import { FollowCamera } from './camera';
beforeAll(initializePhysics);
function mockAssets(){return vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
 const tree=['tree_small','tree_medium','tree_tall'].find(n=>url.includes(n));
 const rock=['rock_small','rock_medium'].find(n=>url.includes(n));
 const name=['locomotive','boxcar','open_wagon'].find(n=>url.includes(n));
 const path=tree?`../../../assets/trees/output/trees_005/${tree}.glb`:rock?`../../../assets/rocks/output/rocks_001/${rock}.glb`:name?`../../../assets/train/output/train_004/${name}.glb`:'../../../assets/car/output/car_001/car.glb';
 const b=readFileSync(new URL(path,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
});}
it('loads approved car/train batches once, shares streamed geometry, isolates signals and cleans owned resources/recreation',async()=>{
 const load=mockAssets(),session=new AuthoritativeSession('generated',4,20261016),view=new GeneratedWorldView();
 try{
  const w=session.snapshot(0).world!;view.update(w);await vi.waitFor(()=>expect(view.group.userData.sections).toBe(w.sections.length));
  await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(9));await new Promise(resolve=>setTimeout(resolve,20));view.refresh();
  const sourceGeometries=new Set<unknown>();view.group.traverse(o=>{if(o instanceof Mesh)sourceGeometries.add(o.geometry);});
  const lamps:MeshStandardMaterial[]=[];view.group.traverse(o=>{if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial&&o.material.emissive.getHex()!==0)lamps.push(o.material);});
  expect(lamps.length).toBeGreaterThan(0);
  const disposals=lamps.map(m=>vi.spyOn(m,'dispose'));
  for(let i=0;i<20;i++){view.update({...w,sections:[],hazards:[]});expect(view.group.children).toHaveLength(0);view.update(w);expect(view.group.children).toHaveLength(w.sections.length);}
  expect(disposals.every(d=>d.mock.calls.length===1)).toBe(true);expect(load).toHaveBeenCalledTimes(9);
  const after=new Set<unknown>();view.group.traverse(o=>{if(o instanceof Mesh)after.add(o.geometry);});expect(after).toEqual(sourceGeometries);
  view.reset();expect(view.group.children).toHaveLength(0);view.update(w);
 }finally{view.dispose();session.dispose();load.mockRestore();}expect(view.group.children).toHaveLength(0);
});
it('interpolates generated hazards with the same assembly timeline and snaps terminal/restart; camera follows beyond fixed courses',()=>{
 const s=new AuthoritativeSession('generated',4,1);
 try{
  const a=s.snapshot(1000),b=structuredClone(a),buffer=new SnapshotBuffer(0);b.tick++;b.serverTimeMs=1100;
  const rail=a.world!.hazards.find(h=>h.railway);const road=a.world!.hazards.find(h=>h.road);
  if(rail){rail.railway!.x=-2;b.world!.hazards.find(h=>h.id===rail.id)!.railway!.x=2;}
  const period=road?roadLanes(a.world!.sections.find(s=>s.id===road.id)!)[0]!.period:36;
  if(road){road.road!.vehicles[0]!.x=period/2-1;b.world!.hazards.find(h=>h.id===road.id)!.road!.vehicles[0]!.x=-period/2+1;}
  b.players[0]!.position.z+=2;buffer.push(a,1000);buffer.push(b,1100);const mid=buffer.sample(1050)!;
  expect(mid.players[0]!.position.z).toBe(1);
  if(rail)expect(mid.world!.hazards.find(h=>h.id===rail.id)!.railway!.x).toBe(0);
  if(road)expect(Math.abs(mid.world!.hazards.find(h=>h.id===road.id)!.road!.vehicles[0]!.x)).toBeCloseTo(period/2,9);
  const end=structuredClone(b);end.tick++;end.serverTimeMs=1200;end.phase='ended';end.world!.outcome='failed';end.world!.dead=['p1'];buffer.push(end,1200);expect(buffer.sample(1150)!.world).toEqual(end.world);expect(buffer.sample(1150)!.players).toEqual(end.players);
  s.reset();buffer.push(s.snapshot(1400),1400);expect(buffer.size).toBe(1);
  const camera=new FollowCamera();camera.resize(800,600);camera.update([{x:-9,y:.8,z:10000},{x:9,y:.8,z:10018}],1,true);
  expect(camera.camera.position.z).toBeGreaterThan(9900);const before=camera.camera.position.z;camera.update([{x:0,y:.8,z:10020}],.016);expect(camera.camera.position.z-before).toBeLessThan(3);
 }finally{s.dispose();}
});
it('generated grass shares one lit material; car batches match lane/collision transforms and retain independent seeded body colors',async()=>{
 const load=mockAssets(),s=new AuthoritativeSession('generated',4,42),v=new GeneratedWorldView();
 try{
  const w=s.snapshot(0).world!;v.update(w);await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(9));await new Promise(r=>setTimeout(r,30));v.refresh();
  const grass=new Set<unknown>(),carColors=new Set<number>();
  for(const [i,section] of w.sections.entries()){
   const root=v.group.children[i]!;
   root.traverse(o=>{if(o instanceof Mesh && o.material instanceof MeshStandardMaterial){if(o.material.color.getHex()===0x64998b)grass.add(o.material);if(o.material.name.startsWith('Car_Mat_Mustard'))carColors.add(o.material.color.getHex());}});
   const cars=root.children.filter(o=>o.userData.color!==undefined);
   expect(cars).toHaveLength(section.type==='road'?generatedVehicleSlots(section).length:0);
   for(const [j,car] of cars.entries()){
    const lane=roadLanes(section)[generatedVehicleSlots(section)[j]!.lane]!;expect(car.position.z).toBe(lane.z);expect(car.rotation.y).toBe(lane.direction*Math.PI/2);expect(car.scale.x).toBe(.8);
    expect(car.position.x).toBe(w.hazards.find(h=>h.id===section.id)!.road!.vehicles[j]!.x);
   }
   const matrix=new Matrix4(),position=new Vector3();
   for(const batch of root.children){
    if(!(batch instanceof InstancedMesh) || !(batch.material instanceof MeshStandardMaterial) || !batch.material.name.startsWith('Car_Mat_Mustard'))continue;
    for(let instance=0;instance<batch.count;instance++){
     batch.getMatrixAt(instance,matrix);position.setFromMatrixPosition(matrix);
     expect(cars.some(car=>car.position.distanceTo(position)<1e-5 && generatedSettings.colors[car.userData.color as number]===batch.material.color.getHex())).toBe(true);
    }
   }
  }
  expect(grass.size).toBe(1);expect(carColors.size).toBeGreaterThan(2);
  const before=[...carColors];v.update(structuredClone(w));const after=new Set<number>();v.group.traverse(o=>{if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial&&o.material.name.startsWith('Car_Mat_Mustard'))after.add(o.material.color.getHex());});expect(after).toEqual(new Set(before));
 }finally{v.dispose();s.dispose();load.mockRestore();}
});

it('actual car palette maps every generated colour exactly and handcrafted pairs retain one fixed colour per lane',async()=>{
 const load=mockAssets(),palette=new TrafficView(true),road=new TrafficView();
 try{
  await palette.load();await road.load();expect(palette.group.children).toHaveLength(5);expect(road.group.children).toHaveLength(6);
  for(const [view,indices] of [[palette,[0,1,2,3,4]],[road,[0,0,1,1,2,2]]] as const){
   view.group.children.forEach((car,i)=>{let bodies=0;car.traverse(o=>{if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial&&o.material.name.startsWith('Car_Mat_Mustard')){bodies++;expect(o.material.color.getHex()).toBe(generatedSettings.colors[indices[i]!]!);}});expect(bodies).toBeGreaterThan(0);});
  }
 }finally{palette.dispose();road.dispose();load.mockRestore();}
});
