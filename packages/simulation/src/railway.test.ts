import { beforeAll, expect, it } from 'vitest';
import { groupScenario, railwayScenario, railwaySettings as rail } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { RailwayChallenge, railwayPose, railwayPeriod, railwayTiming, trainHitsPlayer } from './railway.js';
beforeAll(initializePhysics);
const pose = (id: 'p1'|'p2'|'p3'|'p4' = 'p1', x: number = 0, z: number = rail.z) => ({ id, position: { x, y: .77, z } });
it('provides three seconds before corridor arrival, full advance notice, occupancy and offscreen-only recycle', () => {
  const timing=railwayTiming();
  expect(railwayPeriod()).toBe(7); expect(rail.speed).toBe(35);
  expect(timing.arrival-timing.warning).toBeCloseTo(3,10);
  expect(railwayPose(timing.warning-.001).signal).toBe('safe'); expect(railwayPose(timing.warning).signal).toBe('warning');
  expect(railwayPose(rail.safeSeconds).x).toBe(-36); expect(railwayPose(timing.arrival+.001).signal).toBe('occupying');
  expect(railwayPose(timing.clear+.001).signal).toBe('safe');
  const exit = railwayPose(railwayPeriod() - 1e-6), entry = railwayPose(railwayPeriod());
  expect(exit.x + rail.modules[2].offset - rail.modules[2].length / 2).toBeGreaterThan(rail.halfWidth + .35);
  expect(entry.x + rail.modules[0].length / 2).toBeLessThan(-rail.halfWidth - .35);
  expect(entry.pass).toBe(1); expect(entry.signal).toBe('safe');
});
it.each([1,-1])('sweeps engine, wagon and rear at maximum speed in direction %i; misses outside clearance', direction => {
  const config = { ...rail, direction, speed: rail.maxSpeed };
  for (const module of config.modules) {
    // Entire box travels past a stationary capsule between endpoints with no overlap.
    const x = (-module.offset - module.length / 2 - 1) * direction;
    const end = x + (module.length + 2) * direction;
    expect(trainHitsPlayer(pose().position, pose().position, x, end-x, module, config)).toBe(true);
    expect(trainHitsPlayer(pose('p1',0,6).position, pose('p1',0,6).position, x, end-x, module, config)).toBe(false);
    expect(trainHitsPlayer({x:0,y:8,z:4},{x:0,y:8,z:4},x,end-x,module,config)).toBe(false);
    const rear = module.offset * direction - module.length / 2 * direction;
    expect(trainHitsPlayer(pose('p1',rear).position,pose('p1',rear).position,0,0,module,config)).toBe(true);
  }
});
it('handles relative player motion, grazing width and all middle-player victims once', () => {
  const m=rail.modules[0];
  expect(trainHitsPlayer(pose('p1',0,0).position,pose('p1',0,8).position,0,0,m)).toBe(true);
  expect(trainHitsPlayer(pose('p1',0,4+m.width/2+.35+.001).position,pose('p1',0,4+m.width/2+.35+.001).position,0,0,m)).toBe(false);
  const r=new RailwayChallenge(); const p=[pose('p1',0,0),pose('p2'),pose('p3'),pose('p4',0,8)];
  r.step(p,p,18);expect(r.state()).toMatchObject({outcome:'failed',dead:['p2','p3']});
  const end=r.state();r.step(p,p,100);expect(r.state()).toEqual(end);
});
it('does not sweep an offscreen reset through waiting players', () => {
  const r=new RailwayChallenge();const bank=[pose('p1',0,1)];r.step(bank,bank,railwayPeriod()-.001);
  // A new arrival at the track immediately after reset remains safe.
  const track=[pose()];r.step(track,track,.002);expect(r.state().outcome).toBe('active');
});
it.each([2,3,4] as const)('%i physical players can cross after a passage, pause at warning, retreat, reset deterministically', capacity => {
  const scenario=groupScenario(railwayScenario,capacity);
  const sim=new FoundationSimulation(scenario.players,scenario.boxes,true,[],false,false,true);
  try {
    let final: string|undefined;
    for(let run=0;run<2;run++) {
      // Wait through one complete train; start as it clears the playable corridor.
      for(let i=0;i<Math.ceil((railwayTiming().clear+.1)*60);i++)sim.step({});
      expect(sim.railwayState()!.signal).toBe('safe');
      for(let i=0;i<600 && sim.railwayState()!.outcome==='active';i++)sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:0,z:1}])));
      expect(sim.fault).toBeUndefined();expect(sim.railwayState()!.outcome).toBe('cleared');
      expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
      const serialized=JSON.stringify(sim.states());if(final)expect(serialized).toBe(final);final=serialized;
      const end=sim.states(),chain=sim.chainStates(),train=sim.railwayState();sim.step({p1:{x:1,z:1}});
      expect(sim.states()).toEqual(end);expect(sim.chainStates()).toEqual(chain);expect(sim.railwayState()).toEqual(train);
      sim.reset();expect(sim.railwayState()).toMatchObject({elapsedSeconds:0,pass:0,x:-36,dead:[],outcome:'active'});
      expect(sim.world.bodies.len()).toBe(capacity+12*(capacity-1));expect(sim.world.impulseJoints.len()).toBe(13*(capacity-1));
    }
  } finally {sim.dispose();}
}, 30000);
it.each([2,3,4] as const)('%i physical players can retreat after warning and pull a hesitant middle teammate across', capacity => {
  const sc=groupScenario(railwayScenario,capacity);
  const sim=new FoundationSimulation(sc.players,sc.boxes,true,[],false,false,true);
  try {
    for(let i=0;i<Math.ceil(railwayTiming().warning*60);i++)sim.step({});expect(sim.railwayState()!.signal).toBe('warning');
    for(let i=0;i<60;i++)sim.step(Object.fromEntries(sc.players.map(p=>[p.id,{x:0,z:-1}])));
    expect(sim.states().every(p=>p.position.z< -2)).toBe(true);
    for(let i=0;i<Math.ceil((railwayTiming().clear-railwayTiming().warning-1+.1)*60);i++)sim.step({});
    // Delay one player briefly; cable remains physical and eventually everyone drives.
    for(let i=0;i<600 && sim.railwayState()!.outcome==='active';i++)sim.step(Object.fromEntries(sc.players.map((p,j)=>[p.id,{x:0,z:j===1&&i<90?0:1}])));
    expect(sim.fault).toBeUndefined();expect(sim.railwayState()!.outcome).toBe('cleared');
    expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
  }finally{sim.dispose();}
}, 30000);
it('an idle chain stretched across the crossing fails as the train arrives and freezes intact',()=>{
 const sc=groupScenario(railwayScenario,4),players=sc.players.map((p,i)=>({...p,spawn:{x:0,y:.8,z:i*3-1}}));
 const sim=new FoundationSimulation(players,sc.boxes,true,[],false,false,true);
 try{for(let i=0;i<1200&&sim.railwayState()!.outcome==='active';i++)sim.step({});expect(sim.fault).toBeUndefined();expect(sim.railwayState()!.outcome).toBe('failed');expect(sim.railwayState()!.dead.length).toBeGreaterThan(0);const end=sim.states();sim.step({});expect(sim.states()).toEqual(end);}finally{sim.dispose();}
}, 30000);

it.each([1,-1])('maximum-speed schedule %i is independent of timestep partitions and detects real passage',direction=>{
 const config={...rail,direction,speed:rail.maxSpeed};const p=[pose()];
 const whole=new RailwayChallenge(config),subdivided=new RailwayChallenge(config);
 whole.step(p,p,15.5);for(let i=0;i<15.5*240&&!subdivided.ended;i++)subdivided.step(p,p,1/240);
 expect(whole.state().outcome).toBe('failed');expect(subdivided.state().outcome).toBe('failed');expect(subdivided.state().dead).toEqual(['p1']);
 // Separate safe fixture demonstrates exact scheduling without an early terminal cutoff.
 const bank=[pose('p1',0,0)],a=new RailwayChallenge(config),b=new RailwayChallenge(config);
 a.step(bank,bank,41.25);for(let i=0;i<9900;i++)b.step(bank,bank,1/240);
 expect(a.state().x).toBeCloseTo(b.state().x,6);expect(a.state().pass).toBe(b.state().pass);expect(a.state().signal).toBe(b.state().signal);
});
