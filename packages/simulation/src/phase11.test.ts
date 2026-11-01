import { beforeAll, expect, it } from 'vitest';
import { settings, playerMovementScale, riverSettings, groupScenario, generatedScenario, generateSection, roadLanes, vehicleColor, trafficProfiles, trafficBaseSpeed, trafficMovementScale, railwaySettings as rail } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { RailwayChallenge, railwayPose, railwayTiming } from './railway.js';
import { vehicleX } from './road.js';
beforeAll(initializePhysics);
const floor=[{id:'floor',kind:'ground' as const,center:{x:0,y:-.25,z:100},halfSize:{x:100,y:.25,z:200}}];
it('fixed lane colours imply ordered 1.5× base speeds through every time, slot, tier and reconstruction',()=>{
 expect(trafficMovementScale).toBe(1.5);expect(trafficBaseSpeed).toBe(3.5);
 expect(trafficProfiles.map(p=>p.multiplier)).toEqual([1,1.2,4/3,1.6,1.6]);
 const colors=new Set<number>();
 for(const tier of [0,1,2,3])for(const seed of [1,42,20261016])for(let index=1;index<20;index++){
  const s=generateSection(seed,index,4,undefined,tier);if(s.type!=='road')continue;
  for(const [i,l] of roadLanes(s).entries()){
   const c=vehicleColor(s,i);colors.add(c);
   expect(l.positions.length).toBe(c===0?3:c===1||c===2?4:5);
   for(const time of [0,6,60,120,3600])for(let slot=0;slot<l.positions.length;slot++)expect(vehicleColor(structuredClone(s),i,time,slot)).toBe(c);
   expect(l.speed).toBeCloseTo(5.25*trafficProfiles[c]!.multiplier*[1,1.05,1.05,1.1][tier]!,10);
   expect(l.speed).toBeGreaterThan(4.95); // even yellow exceeds Phase 1's maximum
   const times=l.positions.map(x=>Math.abs(x/l.speed)); const intervals=times.map((t,j)=>(times[j+1]??l.cycle)-t);
   expect(Math.max(...intervals)-Math.min(...intervals)).toBeLessThanOrEqual(.8);
   expect(Math.min(...intervals)*l.speed-3.54*l.scale).toBeGreaterThan(24);
  }
 }
 expect(colors.size).toBe(5);
});
it('traffic never depletes: exact full-cycle lane/cluster occupancy recurs at early and late clocks',()=>{
 for(const seed of [1,42,20261016])for(let index=1;index<12;index++){
  const s=generateSection(seed,index);if(s.type!=='road')continue;
  const lanes=roadLanes(s),cycle=lanes[0]!.cycle;
  const counts=(pass:number)=>Array.from({length:300},(_,tick)=>lanes.map((l,i)=>l.positions.reduce((n,_,slot)=>n+Number(Math.abs(vehicleX(i,slot,cycle*(pass+tick/300),lanes,3))<=10+1.77*l.scale),0)));
  expect(counts(1)).toEqual(counts(100));expect(counts(1)).toEqual(counts(10000));
  for(const l of lanes)expect([3,4,5]).toContain(l.positions.length);
 }
});
it.each([2,3,4] as const)('%i physical seats accelerate to the faster drive, turn, stop and retain full chain geometry/accuracy',capacity=>{
 const defs=groupScenario(generatedScenario,capacity).players;
 const sim=new FoundationSimulation(defs,floor,true);
 try{
  for(let tick=0;tick<180;tick++)sim.step(Object.fromEntries(defs.map(p=>[p.id,{x:0,z:1}])));
  for(const p of sim.states())expect(p.velocity.z).toBeGreaterThan(6.8*playerMovementScale);
  const after=sim.states().map(p=>p.position.z);
  for(let tick=0;tick<90;tick++)sim.step({});
  sim.states().forEach((p,i)=>{expect(Math.hypot(p.velocity.x,p.velocity.z)).toBeLessThan(.03);expect(p.position.z-after[i]!).toBeLessThan(2.3);});
  for(let tick=0;tick<120;tick++)sim.step(Object.fromEntries(defs.map(p=>[p.id,{x:1,z:1}])));
  expect(sim.fault).toBeUndefined();expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.02)).toBe(true);
  expect(sim.world.impulseJoints.len()).toBe(13*(capacity-1));
  expect(sim.chainStates().length).toBe(12*(capacity-1));
 }finally{sim.dispose();}
});
it('solo actual sustained movement is approximately 1.5× measured Phase 1 speed scaled by the authorized .85 refinement, with normalized diagonal response',()=>{
 const actual=[];
 for(const input of [{x:0,z:1},{x:1,z:1}]){
  const sim=new FoundationSimulation([{id:'p1',spawn:{x:0,y:.8,z:0},color:0}],floor,false);
  try{for(let tick=0;tick<180;tick++)sim.step({p1:input});const v=sim.states()[0]!.velocity;actual.push(Math.hypot(v.x,v.z));}finally{sim.dispose();}
 }
 expect(settings.player.speed).toBe(7.5*playerMovementScale);expect(settings.player.acceleration).toBe(28);expect(settings.player.braking).toBe(51);
 expect(actual[0]!/playerMovementScale/4.6759993).toBeGreaterThan(1.48);expect(actual[0]!/playerMovementScale/4.6759993).toBeLessThan(1.55);
 expect(actual[0]).toBeCloseTo(actual[1]!,3);
 expect(riverSettings.speed/settings.player.speed).toBeCloseTo(1.4/5,10);
 expect(riverSettings.acceleration).toBe(12);expect(riverSettings.exposureSeconds).toBe(8);
});
it('35 m/s trains arrive every seven seconds with exact three-second corridor warnings and complete clearance',()=>{
 const t=railwayTiming();expect(rail.speed).toBe(35);expect(t.period).toBe(7);expect(t.arrival-t.warning).toBe(3);
 expect(t.clear-t.arrival).toBeCloseTo(1.0394285714,8);expect(7-(t.clear-t.arrival)).toBeGreaterThan(5.9);
 for(let pass=0;pass<30;pass++){
  expect(railwayPose(pass*7+t.warning-.001).signal).toBe('safe');
  expect(railwayPose(pass*7+t.warning+.001).signal).toBe('warning');
  expect(railwayPose(pass*7+t.arrival+.001).signal).toBe('occupying');
  expect(railwayPose(pass*7+t.clear-.001).signal).toBe('occupying');
  expect(railwayPose(pass*7+t.clear+.001).signal).toBe('safe');
  expect(railwayPose(pass*7+t.arrival).pass).toBe(pass);
 }
 expect(()=>new RailwayChallenge({...rail,safeSeconds:0})).toThrow();
 expect(()=>new RailwayChallenge({...rail,exitX:12})).toThrow();
});
