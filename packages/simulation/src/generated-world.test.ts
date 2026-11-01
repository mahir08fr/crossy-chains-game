import { railwaySettings } from '@crossy/config';
import { beforeAll, expect, it } from 'vitest';
import { sectionCenter, roadLanes, generateSection, groupEnvelope, groupScenario, generatedScenario, sectionBoxes, validateArrangement, validateSection } from '@crossy/config';
import type { Point3 } from '@crossy/config';
import { GeneratedWorld } from './generated-world.js';
import { FoundationSimulation, initializePhysics } from './simulation.js';
beforeAll(initializePhysics);
const sequence=(seed:number,n=1000)=>Array.from({length:n},(_,i)=>generateSection(seed,i));
// Seed enumeration is a correctness check; allow slower development machines.
it('versioned seeds produce distinct repeatable stable arrangements for 2–4 seats and random-access recreation',()=>{
 for(const capacity of [2,3,4] as const)for(const seed of [0,1,42,20261016,0xffffffff]){
  const a=sequence(seed);expect(validateArrangement(a,capacity)).toEqual([]);expect(a).toEqual(sequence(seed));
  expect(a[137]).toEqual(generateSection(seed,137,capacity));expect(new Set(a.map(s=>s.id)).size).toBe(1000);
  expect(new Set(a.map(s=>s.type))).toEqual(new Set(['grass','road','river','railway']));
 }
 expect(sequence(1,40)).not.toEqual(sequence(42,40));
}, 15000);
it('bounded invalid retries reuse a validated compact recipe; rejects clearance/timing/grid/adjacency violations',()=>{
 let calls=0;const s=generateSection(42,1,4,(s)=>{calls++;return {...s,halfWidth:2};});
 expect(calls).toBe(4);expect(s.type).not.toBe('grass');expect(validateSection(s,4)).toEqual([]);
 expect(groupEnvelope(4)).toBe(18.7);
 for(const type of ['road','river','railway'] as const){const good={...generateSection(42,type==='railway'?3:1),type,speed:type==='railway'?35:3,safeSeconds:type==='railway'?railwaySettings.safeSeconds:s.safeSeconds};expect(validateSection(good,4)).toEqual([]);}
 expect(validateSection({...s,type:'road',speed:12},4)).toContain('road-window');
 expect(validateSection({...s,type:'railway',speed:35,safeSeconds:6},4)).toContain('railway-window');
 expect(validateArrangement([s,{...s,index:2,start:37}],4)).not.toEqual([]);
 expect(()=>generateSection(-1,1)).toThrow();expect(()=>generateSection(1,1.5)).toThrow();
});
it('section support edges meet exactly, river uses original slopes and no flat support overlays its water',()=>{
 for(const s of sequence(42,80)){
  const boxes=sectionBoxes(s);expect(new Set(boxes.map(b=>b.id)).size).toBe(boxes.length);
  const ground=boxes.filter(b=>b.kind==='ground');
  expect(Math.min(...ground.map(b=>b.center.z-b.halfSize.z))).toBeCloseTo(s.start,9);
  expect(Math.max(...ground.map(b=>b.center.z+b.halfSize.z))).toBeCloseTo(s.start+s.length,9);
  if(s.type==='river'){
   expect(ground.filter(b=>b.rotationX)).toHaveLength(2);
   expect(ground.filter(b=>!b.rotationX&&b.center.y===-.25).every(b=>b.center.z+b.halfSize.z<=sectionCenter(s)-2.5+1e-8 || b.center.z-b.halfSize.z>=sectionCenter(s)+2.5-1e-8)).toBe(true);
  }
 }
});
it('streams against complete group/cable extent, drops all owned colliders, recreates deterministic hazards at the world clock',()=>{
 let next=0;const live=new Set<number>();const removed:number[]=[];
 const w=new GeneratedWorld(42,4,['p1','p2','p3','p4'],()=>{live.add(++next);return next;},h=>{expect(live.delete(h)).toBe(true);removed.push(h);});
 const point=(z:number):Point3=>({x:0,y:.8,z});w.stream([point(0)]);const initial=w.state();const count=live.size;
 w.stream([point(0),point(200)]);expect(w.state().sections.some(s=>s.index===0)).toBe(true);
 // An adverse retained cable extent keeps old support even with all players far ahead.
 w.stream([point(210),point(209),point(208),point(207),point(24)]);expect(w.state().sections.some(s=>s.index===2)).toBe(true);
 for(let i=0;i<2000;i++){w.stream([point(i*24)]);expect(w.state().sections.length).toBeLessThanOrEqual(19);const rocks=w.state().sections.reduce((n,s)=>n+(s.river?.rocks.length??0),0);expect(live.size-rocks).toBeLessThanOrEqual(134);expect(live.size).toBeLessThanOrEqual(134+19*6);}
 expect(removed.length).toBeGreaterThan(5000);w.stream([point(0)]);expect(w.state()).toEqual(initial);expect(live.size).toBe(count);
});
it('multiple translated rivers share cumulative exposure; safe ground near another water volume cannot clear it',()=>{
 const w=new GeneratedWorld(42,2,['p1','p2'],()=>0,()=>{});w.stream([{x:0,y:.8,z:200}]);
 const river=w.state().sections.find(s=>s.type==='river');expect(river).toBeDefined();const z=sectionCenter(river!);
 const poses=(at:number,y=.47)=>[{id:'p1' as const,position:{x:0,y,z:at},grounded:true},{id:'p2' as const,position:{x:9.9,y:.77,z:0},grounded:true}];
 w.step(poses(z),poses(z),4);expect(w.state().water.players[0]!.exposureSeconds).toBe(4);
 w.step(poses(z-5),poses(z-5),.5);expect(w.state().water.players[0]!.exposureSeconds).toBe(4);
 w.step(poses(z),poses(z),4);expect(w.state().outcome).toBe('failed');expect(w.state().dead).toContain('p1');
});
it.each([2,3,4] as const)('%i seats use original water forces on generated slopes; reset removes terrain and restores seed',capacity=>{
 const river=sequence(42,200).find(s=>s.type==='river')!;
 const defs=groupScenario(generatedScenario,capacity).players.map(p=>({...p,spawn:{...p.spawn,z:river.start+1}}));
 const sim=new FoundationSimulation(defs,[],true,[],false,false,false,42);
 try{
  const initial=sim.generatedState(),colliders=sim.world.colliders.len();let wet=false;
  for(let i=0;i<180;i++)sim.step(Object.fromEntries(sim.states().map((p,j)=>[p.id,{x:Math.max(-1,Math.min(1,((capacity-1)*.45-j*.9-p.position.x)*2)),z:p.position.z>river.start+1?-.3:0}])));
  for(let i=0;i<700;i++){const min=Math.min(...sim.states().map(p=>p.position.z));sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:0,z:p.position.z<=min+.6?1:0}])));wet ||= sim.generatedState()!.water.players.some(p=>p.exposureSeconds>0);if(sim.states().every(p=>p.position.z>river.start+8.9))break;}
  expect(wet).toBe(true);expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('active');
  expect(sim.states().every(p=>p.position.z>river.start+8.9)).toBe(true);
  expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
  for(let i=0;i<4;i++){sim.reset();expect(sim.generatedState()).toEqual(initial);expect(sim.world.colliders.len()).toBe(colliders);}
 }finally{sim.dispose();}
},30000);
it.each(['road','railway'] as const)('translated %s impacts are namespaced and cannot hit a distant section',type=>{
 const seed=42,section=sequence(seed,80).find(s=>s.type===type)!;
 const w=new GeneratedWorld(seed,2,['p1','p2'],()=>0,()=>{});w.stream([{x:0,y:.8,z:sectionCenter(section)}]);
 const poses=(z:number)=>[{id:'p1' as const,position:{x:0,y:.77,z},grounded:true},{id:'p2' as const,position:{x:2,y:.77,z},grounded:true}];
 const dry=poses(0);for(let i=0;i<240;i++)w.step(dry,dry,1/60);expect(w.state().outcome).toBe('active');
 const target=poses(type==='road'?roadLanes(section)[0]!.z:sectionCenter(section));for(let i=0;i<2000&&!w.ended;i++)w.step(target,target,1/60);
 expect(w.state().outcome).toBe('failed');const struck=w.state().hazards.filter(h=>(h.road??h.railway)!.dead.length);
 expect(struck).toHaveLength(1);expect(struck[0]!.id).toBe(section.id);expect(type==='road'?struck[0]!.road:struck[0]!.railway).toBeDefined();
 const final=w.state();w.step(dry,dry,10);expect(w.state()).toEqual(final);
});
it('revisited hazards inherit the world clock instead of replaying their initial safe window',()=>{
 const w=new GeneratedWorld(20261016,2,['p1','p2'],()=>0,()=>{}),p={x:0,y:.8,z:0};
 w.stream([p]);const dry=[{id:'p1' as const,position:p,grounded:true},{id:'p2' as const,position:{...p,x:2},grounded:true}];
 for(let i=0;i<1500;i++)w.step(dry,dry,1/60);
 const before=w.state();w.stream([{...p,z:1200}]);w.stream([p]);
 expect(w.state()).toEqual(before);
});

it('every lane of a five-lane cluster uses authoritative swept collision and stable namespaced state',()=>{
 const section=sequence(42,100).find(s=>s.type==='road'&&roadLanes(s).length===5)!;
 for(const lane of roadLanes(section)){
  const w=new GeneratedWorld(42,4,['p1','p2','p3','p4'],()=>0,()=>{});w.stream([{x:0,y:.8,z:lane.z}]);
  const poses=[{id:'p1' as const,position:{x:0,y:.77,z:lane.z},grounded:true},...(['p2','p3','p4'] as const).map((id,i)=>({id,position:{x:i,y:.77,z:0},grounded:true}))];
  for(let i=0;i<1500&&!w.ended;i++)w.step(poses,poses,1/60);
  expect(w.state().outcome).toBe('failed');const hit=w.state().hazards.find(h=>h.id===section.id)!;
  expect(hit.road!.vehicles).toHaveLength(roadLanes(section).reduce((n,l)=>n+l.positions.length,0));expect(hit.road!.dead).toEqual(['p1']);expect(w.state().dead).toEqual(['p1']);
 }
});
