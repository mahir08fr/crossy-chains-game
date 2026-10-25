import { readFileSync,writeFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { characterAssets } from './character-assets';
import { CharacterView } from './character-view';
import { GooseView } from './goose-view';
import { playerSlots } from '@crossy/protocol';
async function load(url:string){const b=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const percentile=(a:number[],p:number)=>a.sort((a,b)=>a-b)[Math.floor((a.length-1)*p)]!;
it('bounds character resource ownership and measures identical short 2/3/4-seat animation workloads',async()=>{
 const rows:unknown[]=[];
 for(const count of [2,3,4]){
  const start=performance.now(),views=await Promise.all(playerSlots.slice(0,count).map(async id=>new CharacterView(await load(characterAssets[id].landUrl),await load(characterAssets[id].waterUrl),characterAssets[id])));
  const parseMs=performance.now()-start,old=new GooseView(await load(characterAssets.p1.landUrl));
  const times=(run:()=>void)=>{for(let i=0;i<30;i++)run();const samples=[];for(let i=0;i<120;i++){const t=performance.now();run();samples.push(performance.now()-t);}return {p50:percentile(samples,.5),p95:percentile(samples,.95),max:Math.max(...samples)};};
  try{
   const baseline=times(()=>old.update(2,1/60,true,false));
   const land=times(()=>views.forEach(v=>v.update(2,1/60,true,false,.77)));
   views.forEach(v=>v.setWater(true));for(let i=0;i<30;i++)views.forEach(v=>v.update(2,1/60,true,false,.45));
   const water=times(()=>views.forEach(v=>v.update(2,1/60,true,false,.45)));
   const children=views.map(v=>v.model.children.length);for(let i=0;i<20;i++)views.forEach(v=>{v.reset();v.setWater(true);v.update(.2,.02,true,false,.45);});
   expect(views.map(v=>v.model.children.length)).toEqual(children);expect(children.every(n=>n===2)).toBe(true);
   rows.push({seats:count,parseAndCreateMs:parseMs,activeModels:count,residentAuthoredSkins:count*2,triangles:views.reduce((n,v)=>n+v.triangles,0),baselineGooseOnly:baseline,land,water,memory:process.memoryUsage()});
  }finally{old.dispose();views.forEach(v=>v.dispose());}
 }
 if(process.env.M15B_PERFORMANCE==='1')writeFileSync('diagnostics/m15b-animation-performance.json',JSON.stringify({note:'Node actual GLTF parse and CPU animation only; not browser/GPU/long-session memory evidence',rows},null,2));
},15_000);
