import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { AnimationMixer,Mesh,SkinnedMesh,Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterBatch } from './character-batch';
import { characterAssets } from './character-assets';
import { disposeGooseAsset } from './goose-view';
import { playerSlots } from '@crossy/protocol';
async function load(url:string){const b=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
it.each(playerSlots)('preserves every %s rigid vertex/material through complete land and water loops without touching skinning',async slot=>{
 for(const url of [characterAssets[slot].landUrl,characterAssets[slot].waterUrl]){
  const asset=await load(url),sources:Mesh[]=[],skins:SkinnedMesh[]=[];asset.scene.traverse(o=>{if(o instanceof SkinnedMesh)skins.push(o);else if(o instanceof Mesh)sources.push(o);});
  const mixer=new AnimationMixer(asset.scene),batch=new CharacterBatch(asset.scene),v=new Vector3();
  const batches=batch.group.children.filter(o=>o instanceof Mesh) as Mesh[];expect(batches.length).toBeLessThan(sources.length/2);expect(skins.every(s=>s.visible)).toBe(true);
  try{
   for(const clip of asset.animations){
    mixer.stopAllAction();mixer.clipAction(clip).play();
    for(const fraction of [0,.13,.25,.57,.91,1]){
     asset.scene.position.set(fraction*2,-.77,fraction*-3);asset.scene.rotation.y=fraction;asset.scene.scale.setScalar(.9);mixer.setTime(clip.duration*fraction);batch.update();asset.scene.updateMatrixWorld(true);
     const original=new Map<unknown,number[]>(),rendered=new Map<unknown,number[]>();
     for(const [meshes,map] of [[sources,original],[batches,rendered]] as const)for(const mesh of meshes){
      const values=map.get(mesh.material)??[],p=mesh.geometry.getAttribute('position');
      for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);values.push(v.x,v.y,v.z);}map.set(mesh.material,values);
     }
     expect(rendered.size).toBe(original.size);
     // Batches retain source order within each exact original material.
     for(const [material,values] of original){const actual=rendered.get(material)!;expect(actual.length).toBe(values.length);let error=0;for(let i=0;i<values.length;i++)error=Math.max(error,Math.abs(values[i]!-actual[i]!));expect(error).toBeLessThan(2e-6);}
    }
   }
  }finally{mixer.stopAllAction();mixer.uncacheRoot(asset.scene);disposeGooseAsset(asset.scene);}
 }
},15_000);
