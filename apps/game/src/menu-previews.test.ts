import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const gpu=vi.hoisted(()=>({render:vi.fn(),dispose:vi.fn()}));
vi.mock('three',async original=>{const actual=await original<typeof import('three')>();return {...actual,WebGLRenderer:class{
 domElement;info={memory:{geometries:0,textures:0},render:{calls:1}};constructor({canvas}:{canvas:HTMLCanvasElement}){this.domElement=canvas;}setPixelRatio(){}getPixelRatio(){return 1;}setScissorTest(){}setSize(w:number,h:number){this.domElement.width=w;this.domElement.height=h;}clear(){}setViewport(){}setScissor(){}render=gpu.render;dispose=gpu.dispose;
}};});
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Group, Mesh, SkinnedMesh, Vector3 } from 'three';
import { MenuPreviews } from './menu-previews';
import { playerSlots } from '@crossy/protocol';
let load:ReturnType<typeof vi.spyOn>, now=100;
const anchors=()=>playerSlots.map(()=>({dataset:{},textContent:'Loading',getBoundingClientRect:()=>({left:0,bottom:200,top:0,width:200,height:200})}));
let nodes:ReturnType<typeof anchors>;
const canvas=()=>({clientWidth:800,width:0,height:0,hidden:false,remove:vi.fn()}) as unknown as HTMLCanvasElement;
const parse=async(url:string)=>{const bytes=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
beforeEach(()=>{nodes=anchors();now=100;gpu.render.mockClear();gpu.dispose.mockClear();vi.spyOn(performance,'now').mockImplementation(()=>now);vi.stubGlobal('document',{hidden:false,querySelector:(q:string)=>nodes[playerSlots.findIndex(s=>q.includes(s))],querySelectorAll:()=>nodes});vi.stubGlobal('devicePixelRatio',1);vi.stubGlobal('innerWidth',800);vi.stubGlobal('innerHeight',600);vi.stubGlobal('matchMedia',()=>({matches:false}));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>{throw new Error('Preview must not own a RAF');}));load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(parse);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('loads four exact land assets once and uses one canvas with no hidden preview work',async()=>{
 const preview=new MenuPreviews(canvas());await preview.ready;
 expect(load).toHaveBeenCalledTimes(4);expect(preview.metrics().loadedModels).toBe(4);
 preview.draw(100,[]);expect(gpu.render).not.toHaveBeenCalled();
 const targets=playerSlots.map((slot,i)=>({slot,element:nodes[i] as unknown as HTMLElement}));preview.draw(100,targets);expect(gpu.render).toHaveBeenCalledTimes(4);
 Object.assign(document,{hidden:true});now+=40;preview.draw(140,targets);expect(gpu.render).toHaveBeenCalledTimes(4);
 Object.assign(document,{hidden:false});for(let i=0;i<20;i++){now+=40;preview.draw(now,targets);}expect(load).toHaveBeenCalledTimes(4);expect(requestAnimationFrame).not.toHaveBeenCalled();preview.dispose();expect(gpu.dispose).toHaveBeenCalledOnce();
});
it.each(playerSlots)('isolates %s cinematic transforms and restores its ordinary results pose',async slot=>{
 const preview=new MenuPreviews(canvas());await preview.ready;const element=nodes[0] as unknown as HTMLElement;
 preview.draw(100,[{slot,element,cinematicSeconds:.85}]);const scene=gpu.render.mock.calls.at(-1)![0] as import('three').Scene,pivot=scene.children.find(c=>c instanceof Group)!;
 expect(pivot.rotation.y).toBeCloseTo(.4);expect(pivot.rotation.z).toBe(0);expect(pivot.scale.toArray()).toEqual([1,1,1]);
 expect(pivot.rotation.x).toBeCloseTo(Math.PI*2+Math.PI/2);expect(pivot.position.y).toBeCloseTo(2.7);now+=40;preview.draw(140,[{slot,element}]);expect(pivot.rotation.x).toBe(0);expect(Math.abs(pivot.position.y)).toBeLessThanOrEqual(.09);preview.dispose();
});
it('disposes late arriving originals and creates no scenes after teardown',async()=>{
 const pending:{resolve:(g:GLTF)=>void;url:string}[]=[];load.mockImplementation((url:string)=>new Promise<GLTF>(resolve=>pending.push({resolve,url})));
 const preview=new MenuPreviews(canvas());preview.dispose();const dispose=vi.fn();
 for(const p of pending){const gltf=await parse(p.url);gltf.scene.traverse(o=>{if(o instanceof Mesh)o.geometry.addEventListener('dispose',dispose);});p.resolve(gltf);}await preview.ready;
 expect(preview.metrics().loadedModels).toBe(0);expect(dispose).toHaveBeenCalled();expect(gpu.render).not.toHaveBeenCalled();expect(gpu.dispose).toHaveBeenCalledOnce();
});

it.each(playerSlots)('keeps the baked %s preview vertices attached through pivot rotation and the death arc',async slot=>{
 const preview=new MenuPreviews(canvas());await preview.ready;
 try {
  for(const seconds of [undefined,.3,.85,1.4,undefined]){
   now+=100;preview.draw(now,[{slot,element:nodes[0] as unknown as HTMLElement,...(seconds===undefined?{}:{cinematicSeconds:seconds})}]);
   const scene=gpu.render.mock.calls.at(-1)![0] as import('three').Scene;
   scene.updateMatrixWorld(true);
   const source=new Map<unknown,number[]>(),baked=new Map<unknown,number[]>(),v=new Vector3();
   scene.traverse(o=>{
    if(!(o instanceof Mesh))return;
    const map=o.name==='character-material-batch'?baked:o instanceof SkinnedMesh?undefined:source;
    if(!map)return;
    const values=map.get(o.material)??[];
    for(let i=0;i<o.geometry.getAttribute('position').count;i++){o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld);values.push(v.x,v.y,v.z);}
    map.set(o.material,values);
   });
   expect(baked.size).toBe(source.size);
   for(const [material,values] of source){const actual=baked.get(material)!;expect(actual.length).toBe(values.length);let error=0;for(let i=0;i<values.length;i++)error=Math.max(error,Math.abs(values[i]!-actual[i]!));expect(error).toBeLessThan(2e-6);}
  }
 }finally{preview.dispose();}
});
