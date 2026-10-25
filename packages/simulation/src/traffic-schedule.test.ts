import { beforeAll, expect, it } from 'vitest';
import { generateSection, roadLanes, vehicleColor, generatedScenario, groupScenario, railwaySettings } from '@crossy/config';
import { RoadChallenge, vehicleX, vehicleHitsPlayer } from './road.js';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { RailwayChallenge, railwayPeriod, railwayPose, railwayTiming } from './railway.js';
beforeAll(initializePhysics);
const sections=()=>[1,42,20261016].flatMap(seed=>Array.from({length:12},(_,i)=>generateSection(seed,i+1)).filter(s=>s.type==='road'));
it('reconstructs independent lane headways, phases, slots and colors after bounded recipe-cache eviction',()=>{
 const s=sections()[0]!,lanes=structuredClone(roadLanes(s));
 for(let i=0;i<200;i++)roadLanes(generateSection(99,i+1));
 expect(roadLanes(s)).toEqual(lanes);
 expect(new Set(lanes.map(l=>l.positions[1]!/l.speed)).size).toBe(lanes.length);
 for(const [i,l] of lanes.entries()){
  const headways=[Math.abs(l.positions[1]!/l.speed),Math.abs((l.positions[2]!-l.positions[1]!)/l.speed),l.cycle-Math.abs(l.positions[2]!/l.speed)];
  expect(new Set(headways).size).toBe(3);
  const colors=new Set(Array.from({length:6},(_,cycle)=>vehicleColor(s,i,cycle*l.period/l.speed)));
  expect(colors.size).toBe(1);
 }
});
it('supports bounded distinct slots per lane, separate authoritative IDs and minimum bumper clearance at every sampled time',()=>{
 for(const s of sections()){
  const lanes=roadLanes(s),road=new RoadChallenge(lanes,1,Infinity);
  expect(road.state().vehicles).toHaveLength(lanes.reduce((n,l)=>n+l.positions.length,0));
  expect(new Set(road.state().vehicles.map(v=>v.id)).size).toBe(lanes.reduce((n,l)=>n+l.positions.length,0));
  for(const t of [0,.1,10,29,60,120,10000])for(const [i,l] of lanes.entries()){
   const xs=l.positions.map((_,slot)=>vehicleX(i,slot,t,lanes,3));
   for(let a=0;a<l.positions.length;a++)for(let b=a+1;b<l.positions.length;b++){
    const d=Math.abs(xs[a]!-xs[b]!);expect(Math.min(d,l.period-d)-3.54*l.scale).toBeGreaterThan(5.5);
   }
   expect(l.period/2-1.77*l.scale).toBeGreaterThan(10);
  }
 }
});
it('maintains staggered streams over 120 seconds without routine long cluster-wide all-clear intervals',()=>{
 const simultaneous=new Set<number>();
 for(const s of sections().slice(0,12)){
  const lanes=roadLanes(s);let empty=0,streak=0,longest=0;
  for(let tick=0;tick<2400;tick++){
   const counts=lanes.map((l,i)=>l.positions.filter((_,slot)=>Math.abs(vehicleX(i,slot,tick/20,lanes,3))<10+1.77*l.scale).length);
   // Simultaneous cars along the original rendered lane extent (±18 m).
   // Corridor-only (±10 m) occupancy stays a separate density measurement;
   // faster traffic retains group gaps rather than requiring two cars in it.
   lanes.forEach((l,i)=>{if(l.positions.filter((_,slot)=>Math.abs(vehicleX(i,slot,tick/20,lanes,3))<=18).length>=2)simultaneous.add(vehicleColor(s,i));});
   if(counts.every(n=>n===0)){empty++;longest=Math.max(longest,++streak);}else streak=0;
  }
  // Two-lane roads have fewer concurrent cars with the identical per-lane
  // Phase 1.1 schedule. Their all-empty fraction cannot exceed the least
  // empty individual lane (non-overlapping 22.832m corridor footprints).
  const singleLaneBound=Math.min(...lanes.map(l=>1-l.positions.length*(20+3.54*l.scale)/l.period))+.02;
  expect(empty/2400).toBeLessThan(lanes.length===2?singleLaneBound:.2);
  expect(longest/20).toBeLessThan(4);
 }
 expect(simultaneous).toEqual(new Set([0,1,2,3,4]));
});
it.each([1,-1])('sweeps scaled maximum-speed vehicles in direction %i against end and middle players exactly once',direction=>{
 const lane={z:3,speed:9.24,direction,offset:-12*direction,period:72,scale:.8,positions:[0,24*direction,48*direction]};
 const road=new RoadChallenge([lane],1,Infinity);
 const players=([{id:'p1',position:{x:0,y:.77,z:3}},{id:'p2',position:{x:2,y:.77,z:0}},{id:'p3',position:{x:0,y:.77,z:3}},{id:'p4',position:{x:-2,y:.77,z:0}}] as const).map(p=>({...p}));
 expect(vehicleHitsPlayer(players[0]!.position,players[0]!.position,-12*direction,3,24*direction,.8,72)).toBe(true);
 road.step(players,players,5);expect(road.state().dead).toEqual(['p1','p3']);expect(road.state().outcome).toBe('failed');
 const final=road.state();road.step(players,players,50);expect(road.state()).toEqual(final);
});
it('train warning has a three-second floor, faster arrival and full-consist clearance',()=>{
 const c=railwaySettings;
 expect(c.speed).toBe(35);expect(c.warningSeconds).toBe(3);
 expect(()=>new RailwayChallenge({...c,warningSeconds:2.99})).toThrow();
 const warning=railwayTiming(c).warning;
 const arrival=c.safeSeconds+(-c.halfWidth-.35-c.entryX-c.modules[0].length/2)/c.speed;
 expect(arrival-warning).toBeCloseTo(3,6);
 expect(railwayPose(warning-.001).signal).toBe('safe');expect(railwayPose(warning).signal).toBe('warning');
 expect(railwayPose(arrival+.001).signal).toBe('occupying');
 const tail=c.modules.at(-1)!;
 const clear=c.safeSeconds+(c.halfWidth+.35-c.entryX-tail.offset+tail.length/2)/c.speed;
 expect(railwayPose(clear-.001).signal).toBe('occupying');expect(railwayPose(clear+.001).signal).toBe('safe');
 expect(railwayPeriod()-clear+arrival).toBeGreaterThan(5.9);
});

it('four physical seats spread across distinct lanes share one impact/freeze and rebuild deterministic traffic',()=>{
 const section=sections().find(s=>roadLanes(s).length===5)!,lanes=roadLanes(section);
 const defs=groupScenario(generatedScenario,4).players.map((p,i)=>({...p,spawn:{...p.spawn,z:lanes[i]!.z}}));
 const seed=Number(section.id.split(':')[1]),sim=new FoundationSimulation(defs,[],true,[],false,false,false,seed);
 try{
  const initial=sim.generatedState(),bodies=sim.world.bodies.len(),colliders=sim.world.colliders.len();
  expect(new Set(sim.states().map(p=>p.position.z)).size).toBe(4);
  for(let tick=0;tick<2400&&!sim.generatedState()!.dead.length;tick++)sim.step({p1:{x:0,z:0},p2:{x:0,z:0},p3:{x:0,z:0},p4:{x:0,z:0}});
  expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('failed');
  expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
  const players=sim.states(),chain=sim.chainStates(),hazards=sim.generatedState();
  for(let i=0;i<20;i++)sim.step({p1:{x:1,z:1},p2:{x:-1,z:1},p3:{x:0,z:1},p4:{x:0,z:-1}});
  expect(sim.states()).toEqual(players);expect(sim.chainStates()).toEqual(chain);expect(sim.generatedState()).toEqual(hazards);
  sim.reset();expect(sim.generatedState()).toEqual(initial);expect(sim.world.bodies.len()).toBe(bodies);expect(sim.world.colliders.len()).toBe(colliders);
 }finally{sim.dispose();}
},15000);
