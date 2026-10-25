import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {Box3,InstancedMesh,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {riverLayout} from '@crossy/config';
import {RiverRockAssets} from './river-rock-view';
it('loads the supplied metre-scale Y-up GLBs unchanged, shares resources and releases owned instance buffers on streaming',async()=>{
 const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const name=url.includes('rock_small')?'rock_small':'rock_medium';
  const bytes=readFileSync(new URL(`../../../assets/rocks/output/rocks_001/${name}.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const bounds=new Box3().setFromObject(gltf.scene);expect(bounds.min.y).toBeCloseTo(0,6);expect(bounds.max.x-bounds.min.x).toBeCloseTo(name==='rock_small'?.7:1.4,5);expect(bounds.max.y).toBeCloseTo(name==='rock_small'?.3:.46,5);return gltf;
 });
 const assets=new RiverRockAssets(),recipe=riverLayout({id:'v4:1:1',index:1,start:7,length:9.6,halfWidth:10});
 try{
  await assets.load();expect(load).toHaveBeenCalledTimes(2);
  const a=assets.create(recipe),b=assets.create(recipe),sources=new Set();
  a.traverse(o=>{if(o instanceof Mesh)sources.add(o.geometry);});b.traverse(o=>{if(o instanceof Mesh)expect(sources.has(o.geometry)).toBe(true);});
  const counts=()=>{let n=0;a.traverse(o=>{if(o instanceof InstancedMesh)n+=o.count;});return n;};expect(counts()).toBe(recipe.rocks.length*6); // six material primitives per rock
  expect(a.userData.recipe).toEqual(recipe);for(const root of [a,b]){root.traverse(o=>{if(o instanceof InstancedMesh)o.dispose();});root.clear();}
  const c=assets.create(recipe);expect(c.children.length).toBeGreaterThan(0);c.traverse(o=>{if(o instanceof InstancedMesh)o.dispose();});c.clear();
 }finally{assets.dispose();load.mockRestore();}
});
