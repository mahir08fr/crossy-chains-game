import { afterEach, expect, it, vi } from 'vitest';
import { groupScenario, roadScenario, scenarios } from '@crossy/config';
import type { SnapshotMessage } from '@crossy/protocol';
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = { setAttribute() {}, remove() {} }; shadowMap = {};
    setPixelRatio() {} setSize() {} dispose() {} render() {}
  } };
});
import { GameRenderer } from './renderer';
afterEach(() => vi.unstubAllGlobals());
it('keeps the initial local playground at two views and adds only the selected group without growth', () => {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, dataset: {}, textContent: '', setAttribute() {}, append() {}, remove() {} }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const viewport = { append() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) } as unknown as HTMLElement;
  const renderer = new GameRenderer(viewport);
  try {
    renderer.draw(); // Shared display draws its waiting room before any snapshot.
    const snapshot: SnapshotMessage = { protocolVersion:1,scenarioVersion:1,runGeneration:0,tick:0,serverTimeMs:0,phase:'waiting',droppedSeconds:0,players:[] };
    renderer.observeSnapshot(snapshot); expect(renderer.boundaryShading.amount.value).toBe(0);
    renderer.observeSnapshot({...snapshot,phase:'running',serverTimeMs:50}); expect(renderer.boundaryShading.amount.value).toBe(.25);
    renderer.observeSnapshot({...snapshot,serverTimeMs:100}); expect(renderer.boundaryShading.amount.value).toBe(0);
    expect([...renderer.players.keys()]).toEqual(['p1','p2']);
    renderer.setScenario(groupScenario(roadScenario,4));
    expect([...renderer.players.keys()]).toEqual(['p1','p2','p3','p4']);
    const views = [...renderer.players.values()];
    expect(views.every(view => view.group.visible)).toBe(true);
    for(let i=0;i<5;i++) {renderer.setScenario(scenarios[0]!);renderer.setScenario(groupScenario(roadScenario,3));}
    expect([...renderer.players.values()]).toEqual(views);
    expect(renderer.players.get('p4')!.group.visible).toBe(false);
    expect(renderer.players.get('p3')!.group.visible).toBe(true);
    renderer.setScenario(scenarios[0]!);
    expect(renderer.players.get('p3')!.group.visible).toBe(false);
    expect(renderer.players.get('p2')!.group.visible).toBe(true);
  } finally { renderer.dispose(); }
});

it('loads all fixed-slot authored skins once across concurrent calls, resets and capacity changes',async()=>{
  vi.stubGlobal('document', { createElement: () => ({ style: {}, dataset: {}, textContent: '', setAttribute() {}, append() {}, remove() {} }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {readFileSync}=await import('node:fs');
  const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
    const b=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  });
  const viewport={append() {},getBoundingClientRect:()=>({width:800,height:600})} as unknown as HTMLElement;
  const renderer=new GameRenderer(viewport);
  try{
    renderer.setScenario(groupScenario(roadScenario,4));await Promise.all([renderer.loadGoose(),renderer.loadGoose()]);
    expect(load).toHaveBeenCalledTimes(8);expect(Object.values(renderer.characterStatus).filter(s=>s.endsWith(' loaded'))).toHaveLength(4);
    const models=[...renderer.players.values()].map(v=>v.group.children.length);
    for(let i=0;i<10;i++){renderer.setScenario(scenarios[0]!);renderer.setScenario(groupScenario(roadScenario,4));renderer.players.forEach(p=>p.reset());await renderer.loadGoose();}
    expect(load).toHaveBeenCalledTimes(8);expect([...renderer.players.values()].map(v=>v.group.children.length)).toEqual(models);
    expect([...renderer.players.values()].reduce((n,p)=>n+p.characterTriangles,0)).toBe(10449);
  }finally{renderer.dispose();load.mockRestore();}
});

it('reports an individual missing aquatic asset, keeps that placeholder and loads the other correct species',async()=>{
  vi.stubGlobal('document', { createElement: () => ({ style: {}, dataset: {}, textContent: '', setAttribute() {}, append() {}, remove() {} }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const {readFileSync}=await import('node:fs');
  const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
    if(url.includes('axolotl_swimming'))throw new Error('fixture HTTP404');
    const b=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  });
  const viewport={append() {},getBoundingClientRect:()=>({width:800,height:600})} as unknown as HTMLElement,renderer=new GameRenderer(viewport);
  try{
    await expect(renderer.loadGoose()).rejects.toThrow('Axolotl unavailable');
    expect(renderer.characterStatus.p2).toContain('required GLB failed');
    for(const slot of ['p1','p3','p4'])expect(renderer.characterStatus[slot]).toMatch(/ loaded$/);
    expect(renderer.players.get('p2')!.group.children[0]!.visible).toBe(true);
    await expect(renderer.loadGoose()).rejects.toThrow();expect(load).toHaveBeenCalledTimes(8);
  }finally{renderer.dispose();load.mockRestore();}
});

it('disposes late successful loads and never appends a late failure banner after renderer disposal',async()=>{
  vi.stubGlobal('document', { createElement: () => ({ style: {}, dataset: {}, textContent: '', setAttribute() {}, append() {}, remove() {} }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const {readFileSync}=await import('node:fs');
  const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
    if(url.includes('axolotl_swimming'))throw new Error('fixture HTTP404');
    const b=readFileSync('.'+url.split('?')[0]);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  });
  const append=vi.fn(),viewport={append,getBoundingClientRect:()=>({width:800,height:600})} as unknown as HTMLElement,renderer=new GameRenderer(viewport);
  try{
    const loading=renderer.loadGoose();renderer.dispose();await expect(loading).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledTimes(2);expect(renderer.players.size).toBe(2);expect(load).toHaveBeenCalledTimes(8);
  }finally{load.mockRestore();}
});

it('restores the physical chain presentation when a shared run replaces the decorative menu',async()=>{
  vi.stubGlobal('document',{createElement:()=>({style:{},dataset:{},textContent:'',setAttribute(){},append(){},remove(){}})});
  vi.stubGlobal('window',{devicePixelRatio:1});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const load=vi.spyOn(GameRenderer.prototype,'loadGoose').mockResolvedValue();
  const {SharedScene}=await import('./shared-scene');const {protocolVersion}=await import('@crossy/protocol');
  const viewport={append(){},getBoundingClientRect:()=>({width:800,height:600})} as unknown as HTMLElement;
  const scene=new SharedScene(viewport,{replaceChildren(){}} as unknown as HTMLElement);
  try{
    scene.renderer.chain.group.visible=false;
    const players=roadScenario.players.map(p=>({id:p.id,position:p.spawn,velocity:{x:0,y:0,z:0},grounded:true,acknowledgedSequence:0}));
    expect(scene.push({protocolVersion,scenarioVersion:3,runGeneration:1,tick:1,serverTimeMs:100,phase:'running',droppedSeconds:0,players,chain:{course:'road',endpoints:['p1','p2'],segments:Array.from({length:12},()=>({position:{x:0,y:1,z:0},rotation:{x:0,y:0,z:0,w:1}}))}},100)).toBe(true);
    expect(scene.renderer.chain.group.visible).toBe(true);
  }finally{scene.dispose();load.mockRestore();}
});

it('retains the single original shadow light and settings while adding directional sky/ground fill',()=>{
 vi.stubGlobal('document',{createElement:()=>({style:{},dataset:{},setAttribute(){},append(){},remove(){}})});vi.stubGlobal('window',{devicePixelRatio:1});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const r=new GameRenderer({append(){},getBoundingClientRect:()=>({width:800,height:600})} as unknown as HTMLElement);
 try {
  const sun=r.scene.children.find(o=>o.type==='DirectionalLight') as import('three').DirectionalLight;
  const fill=r.scene.children.find(o=>o.type==='HemisphereLight') as import('three').HemisphereLight;
  expect(sun.intensity).toBe(3);expect(sun.color.getHex()).toBe(0xfff0d5);expect(sun.shadow.mapSize.toArray()).toEqual([1024,1024]);expect(sun.shadow.normalBias).toBe(.04);
  expect(r.scene.children.filter(o=>'castShadow' in o&&o.castShadow&&o.type.endsWith('Light'))).toHaveLength(1);expect(fill.intensity).toBe(2);expect(fill.castShadow).toBe(false);
  r.effects.emit({kind:'train',slot:'p1',position:{x:0,y:1,z:0}});r.effects.update(.1);expect(r.effects.metrics().active).toBe(1);r.setScenario(scenarios[0]!);expect(r.effects.metrics().active).toBe(0);
 }finally{r.dispose();}
});
