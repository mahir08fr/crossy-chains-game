import { expect, it, vi } from 'vitest';
import type { PlayerSlot, SnapshotMessage } from '@crossy/protocol';
import { VisualEffects, VisualEventTracker, effectLimits } from './visual-effects';
const slots = ['p1','p2','p3','p4'] as const;
const snapshot = (time: number, phases: ('safe'|'entering'|'endangered'|'recovering')[] = ['safe','safe','safe','safe']): SnapshotMessage => ({
 protocolVersion:1,scenarioVersion:5,runGeneration:1,tick:time,serverTimeMs:time,phase:'running',droppedSeconds:0,
 players:slots.map((id,i)=>({id,position:{x:i*2,y:.47,z:10},velocity:{x:0,y:0,z:0},grounded:false,acknowledgedSequence:0})),
 river:{exposureLimitSeconds:8,recoverySeconds:1,players:slots.map((id,i)=>({id,phase:phases[i]!,exposureSeconds:0,safeSeconds:0})),dead:[],outcome:'active'},
});
it('uses actual water transitions for all seats with no spawn, snapshot or animation replay',()=>{
 const tracker=new VisualEventTracker();expect(tracker.observe(snapshot(0))).toEqual([]);
 const entry=snapshot(50,slots.map(()=> 'entering'));expect(tracker.observe(entry).map(e=>[e.kind,e.slot,e.position.y])).toEqual(slots.map(s=>['entry',s,.065]));
 expect(tracker.observe(entry)).toEqual([]);expect(tracker.observe(snapshot(100,slots.map(()=> 'endangered')))).toEqual([]);
 for(const t of [200,300])expect(tracker.observe(snapshot(t,slots.map(()=> 'endangered')))).toEqual([]);
 expect(tracker.observe(snapshot(400,slots.map(()=> 'recovering'))).map(e=>e.kind)).toEqual(['exit','exit','exit','exit']);
 expect(tracker.observe(snapshot(450))).toEqual([]);
});
it('bounds small fluctuations without delaying or modifying authoritative water state',()=>{
 const t=new VisualEventTracker();t.observe(snapshot(0));expect(t.observe(snapshot(50,['entering','safe','safe','safe']))).toHaveLength(1);
 expect(t.observe(snapshot(100))).toEqual([]);expect(t.observe(snapshot(150,['entering','safe','safe','safe']))).toEqual([]);
 t.observe(snapshot(300,['endangered','safe','safe','safe']));expect(t.observe(snapshot(400))).toHaveLength(1);
});
it('silently primes restart, pause/resume, reconnect, gaps and missing/reconstructed state',()=>{
 const t=new VisualEventTracker();t.observe(snapshot(0));const changed=snapshot(50,['entering','safe','safe','safe']);changed.runGeneration=2;expect(t.observe(changed)).toEqual([]);
 t.reset();expect(t.observe(changed)).toEqual([]);expect(t.observe({...snapshot(400),runGeneration:2})).toEqual([]);
 const paused={...snapshot(450),runGeneration:2,phase:'paused' as const};expect(t.observe(paused)).toEqual([]);
 expect(t.observe({...snapshot(500,['entering','safe','safe','safe']),runGeneration:2})).toEqual([]);
 const missing={...snapshot(550),runGeneration:2};delete missing.river;t.observe(missing);expect(t.observe({...snapshot(600),runGeneration:2})).toEqual([]);
});
function collision(time:number, kind:'car'|'train', dead:PlayerSlot[]):SnapshotMessage {
 const s=snapshot(time);delete s.river;s.phase=dead.length?'ended':'running';
 if(kind==='car')s.road={elapsedSeconds:1,vehicles:[],dead,outcome:dead.length?'failed':'active'};
 else s.railway={elapsedSeconds:1,pass:0,x:0,signal:'occupying',dead,outcome:dead.length?'failed':'active'};
 return s;
}
it.each(['car','train'] as const)('emits %s once per correct authoritative victim and suppresses terminal reclaim',kind=>{
 const t=new VisualEventTracker();t.observe(collision(0,kind,[]));const s=collision(50,kind,['p2','p4']);const original=structuredClone(s);
 expect(t.observe(s)).toEqual(['p2','p4'].map(slot=>({kind,slot,position:s.players.find(p=>p.id===slot)!.position})));
 expect(s).toEqual(original);expect(t.observe(s)).toEqual([]);expect(t.observe(collision(100,kind,['p2','p4']))).toEqual([]);
 t.reset();expect(t.observe(s)).toEqual([]);
});
it('reads generated per-hazard provenance; drowning/safety never invent an impact',()=>{
 const t=new VisualEventTracker(),a=snapshot(0);delete a.river;
 a.world={version:4,riverVersion:1,highWater:0,rearLimit:-7,seed:1,elapsedSeconds:0,sections:[],hazards:[],water:snapshot(0).river!,dead:[],outcome:'active'};t.observe(a);
 const b=structuredClone(a);b.serverTimeMs=50;b.phase='ended';b.world!.hazards=[{id:'r',road:{elapsedSeconds:0,vehicles:[],dead:['p3'],outcome:'failed'}},{id:'t',railway:{elapsedSeconds:0,pass:0,x:0,signal:'occupying',dead:['p1'],outcome:'failed'}}];
 b.world!.water.dead=['p2'];b.world!.dead=['p1','p2','p3'];
 expect(t.observe(b).map(e=>[e.kind,e.slot])).toEqual([['train','p1'],['car','p3']]);
});
it('keeps fixed resources, hard caps bursts/particles, reuses storage and expires after a stall',()=>{
 const fx=new VisualEffects(),geometry=fx.particles.geometry,material=fx.particles.material,matrix=fx.particles.instanceMatrix,color=fx.particles.instanceColor;
 const event={kind:'train' as const,slot:'p1' as const,position:{x:0,y:1,z:0}};
 for(let i=0;i<30;i++)fx.emit(event);fx.update(0);
 expect(fx.metrics()).toMatchObject({active:16,particles:224,dropped:14,peak:16});expect(fx.particles.castShadow).toBe(false);
 fx.update(1);expect(fx.metrics()).toMatchObject({active:0,particles:0});expect(fx.group.visible).toBe(false);
 for(let i=0;i<100;i++){fx.emit({...event,kind:'entry'});fx.update(.02);fx.clear();}
 expect(fx.particles.geometry).toBe(geometry);expect(fx.particles.material).toBe(material);expect(fx.particles.instanceMatrix).toBe(matrix);expect(fx.particles.instanceColor).toBe(color);
 expect(matrix.count).toBe(effectLimits.bursts*effectLimits.particlesPerBurst);
 const g=vi.fn(),m=vi.fn(),instances=vi.fn();geometry.addEventListener('dispose',g);material.addEventListener('dispose',m);fx.particles.addEventListener('dispose',instances);
 fx.dispose();fx.dispose();expect(g).toHaveBeenCalledOnce();expect(m).toHaveBeenCalledOnce();expect(instances).toHaveBeenCalledOnce();expect(fx.emit(event)).toBe(false);
});
it('respects reduced motion and has smaller exit/car bursts than entry/train',()=>{
 const fx=new VisualEffects();const event={slot:'p1' as const,position:{x:0,y:0,z:0}};
 expect(fx.emit({...event,kind:'train'},true)).toBe(false);
 for(const [kind,n] of [['exit',6],['entry',9],['car',10],['train',14]] as const){fx.emit({...event,kind});fx.update(0);expect(fx.metrics().particles).toBe(n);fx.clear();}
 fx.dispose();
});

it.each([2,3,4])('keeps %i-seat event association across repeated deliveries and streaming-only rebuilds',count=>{
 const t=new VisualEventTracker(),a=snapshot(0);a.players=a.players.slice(0,count);a.river!.players=a.river!.players.slice(0,count);t.observe(a);
 const b=structuredClone(a);b.serverTimeMs=50;b.river!.players.forEach(p=>p.phase='entering');expect(t.observe(b).map(e=>e.slot)).toEqual(slots.slice(0,count));
 const c=structuredClone(b);c.serverTimeMs=100;expect(t.observe(c)).toEqual([]);
 expect(t.observe(a)).toEqual([]);
});

it('measures bounded pooled update/creation work without a browser or GPU performance claim',async()=>{
 const fx=new VisualEffects();
 const event={kind:'train' as const,slot:'p1' as const,position:{x:0,y:1,z:0}};
 const creation:number[]=[],updates:number[]=[];
 for(let warm=0;warm<50;warm++){fx.clear();for(let i=0;i<16;i++)fx.emit(event);fx.update(.1);}
 for(let sample=0;sample<600;sample++){
  fx.clear();let start=performance.now();for(let i=0;i<16;i++)fx.emit(event);creation.push(performance.now()-start);
  start=performance.now();fx.update(.16);updates.push(performance.now()-start);
  expect(fx.metrics().particles).toBe(224);
 }
 const stats=(a:number[])=>{a.sort((x,y)=>x-y);return {mean:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
 // Ordinary regressions must not overwrite historical measurement artifacts.
 if(process.env.M15E_PERFORMANCE==='1'){
  const {writeFileSync}=await import('node:fs');
  writeFileSync('diagnostics/m15e-pool-performance.json',JSON.stringify({environment:'Node CPU only; not GPU/frame-time/heap evidence',samples:600,burstsPerSample:16,particles:224,creationBatchMs:stats(creation),updateMs:stats(updates),geometryCount:1,materialCount:1,textureCount:0,matrixBytes:fx.particles.instanceMatrix.array.byteLength,colorBytes:fx.particles.instanceColor!.array.byteLength},null,2)+'\n');
 }
 fx.dispose();
});

it('adds only fixture shadow participation, preserving lamp geometry, colour and existing warning emission',async()=>{
 const {RailwayView}=await import('./railway-view');const {Mesh,MeshStandardMaterial}=await import('three');const rail=new RailwayView();
 try{
  const lamps=rail.group.children.filter(o=>o instanceof Mesh && (o.geometry as import('three').BoxGeometry).parameters?.width===.45) as import('three').Mesh<import('three').BoxGeometry,import('three').MeshStandardMaterial>[];
  expect(lamps).toHaveLength(2);expect(rail.group.children).toHaveLength(11);
  for(const lamp of lamps){expect(lamp.castShadow).toBe(true);expect(lamp.receiveShadow).toBe(true);expect(lamp.material).toBeInstanceOf(MeshStandardMaterial);expect(lamp.scale.toArray()).toEqual([1,1,1]);expect(lamp.geometry.parameters).toMatchObject({width:.45,height:.45,depth:.16});}
  rail.update({elapsedSeconds:0,pass:0,x:0,signal:'warning',dead:[],outcome:'active'});
  expect(lamps[0]!.material.color.getHex()).toBe(0xffba42);expect(lamps[0]!.material.emissiveIntensity).toBe(.15);
  rail.update({elapsedSeconds:.25,pass:0,x:0,signal:'warning',dead:[],outcome:'active'});expect(lamps[0]!.material.emissiveIntensity).toBe(.7);
 }finally{rail.dispose();}
});
