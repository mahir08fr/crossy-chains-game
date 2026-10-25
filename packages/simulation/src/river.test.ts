import { beforeAll, expect, it } from 'vitest';
import { groupScenario, riverScenario, riverSettings as water, settings } from '@crossy/config';
import type { GroupSize, PlayerDefinition, PlayerId } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { RiverChallenge, inRiver } from './river.js';
beforeAll(initializePhysics);
const dry = (id: PlayerId = 'p1', z = 0) => ({ id, position: { x: 0, y: .77, z }, grounded: true });
const wet = (id: PlayerId = 'p1') => ({ ...dry(id, 4.5), position: { x: 0, y: .32, z: 4.5 } });
function fixture(capacity: GroupSize = 2, players?: readonly PlayerDefinition[]) {
  const s = groupScenario(riverScenario, capacity);
  return new FoundationSimulation(players ?? s.players, s.boxes, true, [], false, true);
}
it('classifies exact capsule/volume entry boundaries and rejects above-water poses', () => {
  expect(inRiver({ x: 0, y: .77, z: water.minZ - settings.player.radius })).toBe(true);
  expect(inRiver({ x: 0, y: .77, z: water.minZ - settings.player.radius - .001 })).toBe(false);
  expect(inRiver({ x: 0, y: .77, z: water.maxZ + settings.player.radius })).toBe(true);
  expect(inRiver({ x: 0, y: .77, z: water.maxZ + settings.player.radius + .001 })).toBe(false);
  expect(inRiver({ x: 0, y: 3, z: 4 })).toBe(false);
});
it('accumulates exposure across edge oscillation, needs sustained supported recovery, freezes failure', () => {
  const r = new RiverChallenge(['p1','p2']);
  r.step([wet(),dry('p2')], .01); expect(r.state().players[0]!.phase).toBe('entering');
  r.step([wet(),dry('p2')], 3.99);
  r.step([dry(),dry('p2')], .5); expect(r.state().players[0]!.exposureSeconds).toBe(4);
  r.step([wet(),dry('p2')], 1); expect(r.state().players[0]!.exposureSeconds).toBe(5);
  r.step([{ ...dry(),grounded:false },dry('p2')], 10); expect(r.state().players[0]!.exposureSeconds).toBe(5);
  r.step([dry(),dry('p2')], 1); expect(r.state().players[0]!).toMatchObject({phase:'safe',exposureSeconds:0});
  r.step([wet(),wet('p2')], 8); expect(r.state()).toMatchObject({outcome:'failed',dead:['p1','p2']});
  const end=r.state();r.step([dry(),dry('p2')],100);expect(r.state()).toEqual(end);
});
it('requires all players safely beyond the finish and does not clear while endangered', () => {
  const r=new RiverChallenge(['p1','p2']);r.step([dry('p1',11),dry('p2')],1);expect(r.state().outcome).toBe('active');
  r.step([dry('p1',11),dry('p2',11)],1);expect(r.state().outcome).toBe('cleared');
});
it.each([2,3,4] as const)('%i-player river crossing, reset and whole-assembly terminal freeze are deterministic', capacity => {
  const sim=fixture(capacity);
  try {
    const initial=sim.riverState(); let finalPoses: string | undefined;
    for(let run=0;run<2;run++) {
      for(let i=0;i<1000 && sim.riverState()!.outcome==='active';i++) sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:0,z:1}])));
      expect(sim.fault).toBeUndefined();expect(sim.riverState()!.outcome).toBe('cleared');
      expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
      if (finalPoses) expect(JSON.stringify(sim.states())).toBe(finalPoses); else finalPoses=JSON.stringify(sim.states());
      const end=sim.states(),chain=sim.chainStates(),river=sim.riverState();sim.step({p1:{x:1,z:1}});
      expect(sim.states()).toEqual(end);expect(sim.chainStates()).toEqual(chain);expect(sim.riverState()).toEqual(river);
      sim.reset();expect(sim.riverState()).toEqual(initial);
      expect(sim.world.bodies.len()).toBe(capacity+12*(capacity-1));expect(sim.world.impulseJoints.len()).toBe(13*(capacity-1));
    }
  } finally {sim.dispose();}
});
it('water drive is slower than land; forces permit physical teammate pulling up the slope', () => {
  const players=riverScenario.players.map((p,i)=>({...p,spawn:{x:0,y:.8,z:i===0?-2:3.8}}));
  const sim=fixture(2,players);
  try {
    // P2 gets no drive. P1 walks away on land and pulls it through unchanged joints.
    const initial=sim.state('p2').position.z;
    for(let i=0;i<360 && sim.riverState()!.outcome==='active';i++) sim.step({p1:{x:0,z:-1}});
    expect(sim.fault).toBeUndefined();expect(sim.state('p2').position.z).toBeLessThan(initial-2);
    expect(sim.riverState()!.players[1]!.phase).toBe('safe');
    expect(sim.chainMetrics()!.maxAnchorError).toBeLessThan(.3);
  } finally {sim.dispose();}
  const sample=(z:number)=>{
    const s=fixture(2,riverScenario.players.map(p=>({...p,spawn:{...p.spawn,z}})));
    try {for(let i=0;i<45;i++)s.step({p1:{x:1,z:0},p2:{x:1,z:0}});return s.state().velocity.x;}finally{s.dispose();}
  };
  expect(sample(4.5)).toBeLessThan(sample(-1)*.4);
});
it.each([2,3,4] as const)('%i players: multiple wet/middle bodies and opposing tension remain finite until shared failure',capacity=>{
 const players=groupScenario(riverScenario,capacity).players.map(p=>({...p,spawn:{...p.spawn,z:4.5,y:.34}}));
 const sim=fixture(capacity,players);
 try {
  for(let i=0;i<600 && sim.riverState()!.outcome==='active';i++)sim.step(Object.fromEntries(players.map((p,j)=>[p.id,{x:j%2?1:-1,z:0}])));
  expect(sim.fault).toBeUndefined();expect(sim.riverState()!.outcome).toBe('failed');
  expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
  const end=sim.states();for(let i=0;i<60;i++)sim.step({});expect(sim.states()).toEqual(end);
 }finally{sim.dispose();}
});

it.each([3,4] as const)('%i players: land endpoints pull a wet middle player out without a rescue script',capacity=>{
 const defs=groupScenario(riverScenario,capacity).players.map((p,i)=>({...p,spawn:{x:(capacity-1)*1.2-i*2.4,y:.8,z:i===1?3:-1}}));
 const sim=fixture(capacity,defs);
 try {
  let sawWet=false;
  for(let i=0;i<450 && sim.riverState()!.outcome==='active';i++){
   sim.step(Object.fromEntries(defs.filter(p=>p.id!=='p2').map(p=>[p.id,{x:0,z:-1}])));
   sawWet ||= sim.riverState()!.players[1]!.exposureSeconds>0;
  }
  expect(sawWet).toBe(true);expect(sim.fault).toBeUndefined();expect(sim.riverState()!.players[1]!.phase).toBe('safe');
  expect(sim.state('p2').position.z).toBeLessThan(1.5);
  expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.3)).toBe(true);
 }finally{sim.dispose();}
});
