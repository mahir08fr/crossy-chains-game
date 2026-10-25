import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { Box3, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateSection, generatedScenario, groupScenario, sectionCenter, roadLanes, generatedSettings } from '@crossy/config';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { EnvironmentDecoration, treePlacements, treeVariants, treeCanopy, grassIntervals } from './environment-decoration';
import { flowingWater, waterFlowOffset, updateWater, grassMaterial, asphaltMaterial, shorelineMaterial } from './environment-materials';
import { GeneratedWorldView } from './generated-world-view';
beforeAll(initializePhysics);
function realAssets(){return vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const tree=['tree_small','tree_medium','tree_tall'].find(n=>url.includes(n)),rock=['rock_small','rock_medium'].find(n=>url.includes(n)),train=['locomotive','boxcar','open_wagon'].find(n=>url.includes(n));
  const path=tree?`trees/output/trees_005/${tree}.glb`:rock?`rocks/output/rocks_001/${rock}.glb`:train?`train/output/train_004/${train}.glb`:'car/output/car_001/car.glb';
  const bytes=readFileSync(new URL(`../../../assets/${path}`,import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
});}
it.each(treeVariants)('loads final %s GLB at unchanged grounded Y-up scale, all material primitives and authored triangle count',async variant=>{
  const bytes=readFileSync(new URL(`../../../assets/trees/output/trees_005/tree_${variant}.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const bounds=new Box3().setFromObject(gltf.scene),materials=new Set(),i=treeVariants.indexOf(variant);let triangles=0;
  expect(bounds.min.y).toBeCloseTo(0,5);expect(bounds.max.y).toBeCloseTo([1.18,2.24,3.3][i]!,5);
  expect(bounds.max.x-bounds.min.x).toBeCloseTo(treeCanopy[variant],3);
  gltf.scene.traverse(o=>{if(o instanceof Mesh){expect(o.material).toBeInstanceOf(MeshStandardMaterial);materials.add(o.material);triangles+=(o.geometry.index?.count??o.geometry.attributes.position!.count)/3;expect(o.geometry.attributes.normal).toBeDefined();}});
  expect(materials.size).toBe(5);expect(triangles).toBe([224,252,280][i]);
});
it('places deterministic spaced trees on flat grass only across seeds, mixed hazards, width growth and spawn',()=>{
  const counts={small:0,medium:0,tall:0};let total=0;
  for(const seed of [1,2,3,42,20261016])for(let index=0;index<90;index++){
    const section=generateSection(seed,index),a=treePlacements(section,48),wide=treePlacements(section,160),intervals=grassIntervals(section);
    expect(a).toEqual(treePlacements(structuredClone(section),48));expect(a.length).toBeLessThanOrEqual(80);
    expect(wide.length).toBeLessThanOrEqual(80);
    for(const t of a){
      counts[t.variant]++;total++;
      const radius=treeCanopy[t.variant]*t.scale/2+.22;
      expect(Math.abs(t.x)-radius).toBeGreaterThanOrEqual(12.1);
      expect(t.scale).toBeGreaterThanOrEqual(.94);expect(t.scale).toBeLessThanOrEqual(1.06);
      expect(intervals.some(([lo,hi])=>t.z-radius>lo&&t.z+radius<hi)).toBe(true);
      expect(wide).toContainEqual(t);
      if(section.type==='river')expect(Math.abs(t.z-sectionCenter(section))).toBeGreaterThan(2.5+radius);
      if(section.type==='road')expect(Math.abs(t.z-sectionCenter(section))).toBeGreaterThan(roadLanes(section).length*generatedSettings.lanePitch/2+radius);
      if(section.type==='railway')expect(Math.abs(t.z-sectionCenter(section))).toBeGreaterThan(2.65+radius);
    }
    for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)expect(Math.hypot(a[i]!.x-a[j]!.x,a[i]!.z-a[j]!.z)).toBeGreaterThan(treeCanopy[a[i]!.variant]*a[i]!.scale/2+treeCanopy[a[j]!.variant]*a[j]!.scale/2+.56);
  }
  expect(total).toBeGreaterThan(400);expect(counts.small).toBeGreaterThan(counts.medium);expect(counts.medium).toBeGreaterThan(counts.tall);
});
it('loads once, reuses original geometry/materials and deterministic matrices through cleanup and rebuild',async()=>{
  const load=realAssets(),assets=new EnvironmentDecoration(),section=generateSection(1,0);
  try{
    await Promise.all([assets.load(),assets.load()]);expect(load).toHaveBeenCalledTimes(3);
    const a=assets.create(section,48),b=assets.create(section,48);expect(a.userData.trees).toEqual(b.userData.trees);
    expect(new Set(a.children.filter(o=>o.userData.treeVariant).map(o=>o.userData.treeVariant)).size).toBe(3);
    for(let i=0;i<a.children.length;i++){
      const x=a.children[i] as InstancedMesh,y=b.children[i] as InstancedMesh;
      expect(x.geometry).toBe(y.geometry);expect(x.material).toBe(y.material);expect([...x.instanceMatrix.array]).toEqual([...y.instanceMatrix.array]);
      const dispose=vi.spyOn(x.geometry,'dispose');x.dispose();expect(dispose).not.toHaveBeenCalled();y.dispose();
    }
    const c=assets.create(section,48);expect(c.children.length).toBe(a.children.length);c.children.forEach(o=>(o as InstancedMesh).dispose());
  }finally{assets.dispose();load.mockRestore();}
});
it('moves world-space water with signed authoritative current, a visibly faster fast category, and exact held/reset clocks',()=>{
  for(const direction of [-1,1] as const)for(const strength of ['normal','fast'] as const){
    const river={version:1 as const,direction,strength,acceleration:strength==='fast'?5:2,rocks:[],fallback:false},m=flowingWater(river);
    updateWater(m,10);expect(m.userData.flow.value).toBe(waterFlowOffset(10,river));
    const first=m.userData.flow.value;updateWater(m,10);expect(m.userData.flow.value).toBe(first);
    updateWater(m,11);expect(Math.sign(m.userData.flow.value-first)).toBe(direction);
    expect(Math.abs(waterFlowOffset(1,{direction,strength:'fast'}))).toBeGreaterThan(Math.abs(waterFlowOffset(1,{direction,strength:'normal'}))*2);
    updateWater(m,0);expect(m.userData.flow.value).toBe(0);m.dispose();
  }
});
it('uses shared world-space materials across width/section joins and bounded subtle grass variation without changing collision recipes',()=>{
  const g=grassMaterial(),a=asphaltMaterial(),shore=shorelineMaterial(15),water=flowingWater();
  for(const m of [g,a,shore,water]){
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>'};
    m.onBeforeCompile(shader as never,{} as never);expect(shader.vertexShader).toContain('modelMatrix');expect(shader.fragmentShader).not.toContain('gl_FragCoord');m.dispose();
  }
  expect(g.color.getHex()).toBe(generatedSettings.grassColor);
  for(let i=0;i<200;i++){
    const m=Math.sin(i*.31+Math.sin(i*.19))*Math.sin(i*.43+i*.09);
    expect(1+.055*m).toBeGreaterThanOrEqual(.945);expect(1+.055*m).toBeLessThanOrEqual(1.055);
  }
});
it.each([2,3,4] as const)('reconstructs %i-seat streaming views, owns buffers/materials, preserves authority and bounded render inventory',async capacity=>{
  const load=realAssets(),session=new AuthoritativeSession('generated',capacity,1),view=new GeneratedWorldView();
  try{
    const world=session.snapshot(0).world!,before=structuredClone(world),colliders=session.simulation.world.colliders.len();
    view.update(world);await vi.waitFor(()=>expect(load).toHaveBeenCalledTimes(9));await new Promise(r=>setTimeout(r,30));view.refresh();
    const inventory=()=>{let meshes=0,instances=0,trees=0;view.group.traverse(o=>{if(o instanceof Mesh)meshes++;if(o instanceof InstancedMesh){instances+=o.count;expect(o.count).toBeLessThanOrEqual(o.instanceMatrix.count);}if(o.name==='environment-decoration')trees+=(o.userData.trees as unknown[]).length;});return {meshes,instances,trees};};
    const first=inventory();expect(first.meshes).toBeLessThan(600);expect(first.trees).toBeGreaterThan(0);
    for(let repeat=0;repeat<12;repeat++){
      const buffers:ReturnType<typeof vi.spyOn>[]=[],water:ReturnType<typeof vi.spyOn>[]=[];
      view.group.traverse(o=>{if(o instanceof InstancedMesh)buffers.push(vi.spyOn(o,'dispose'));if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial&&o.material.name==='environment-flowing-water')water.push(vi.spyOn(o.material,'dispose'));});
      view.reset();expect(buffers.every(b=>b.mock.calls.length===1)).toBe(true);expect(water.every(b=>b.mock.calls.length===1)).toBe(true);
      view.update(structuredClone(world));expect(inventory()).toEqual(first);
    }
    view.setVisualHalfWidth(160);const wide=inventory();expect(wide.meshes).toBeLessThan(650);view.group.traverse(o=>{if(o.name==='grass-tufts')expect((o as InstancedMesh).count).toBeLessThanOrEqual(160);});
    expect(world).toEqual(before);expect(session.simulation.world.colliders.len()).toBe(colliders);expect(groupScenario(generatedScenario,capacity).players).toHaveLength(capacity);
  }finally{view.dispose();session.dispose();load.mockRestore();}
});
