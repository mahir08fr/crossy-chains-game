import { beforeAll, expect, it } from 'vitest';
import { generatedScenario, groupScenario } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
beforeAll(initializePhysics);
it.each([2,3,4] as const)('%i seats: forward progress, force-driven retreat/contact, staggered leaders, full-chain stability and reset',capacity=>{
 const defs=groupScenario(generatedScenario,capacity).players;
 const sim=new FoundationSimulation(defs,[],true,[],false,false,false,42);
 try{
  const initial=sim.generatedState();let high=0,rear=-6.7,maxGap=0;
  const step=(z:number,stagger=false)=>{
   sim.step(Object.fromEntries(defs.map((p,i)=>[p.id,{x:0,z:stagger&&i===0?0:z}])));
   const w=sim.generatedState()!,points=[...sim.states(),...sim.chainStates()].map(p=>p.position);
   expect(w.highWater).toBeGreaterThanOrEqual(high);expect(w.rearLimit).toBeGreaterThanOrEqual(rear);
   expect(Math.min(...points.map(p=>p.z))).toBeGreaterThan(w.rearLimit-.02);
   high=w.highWater;rear=w.rearLimit;
   expect(sim.fault).toBeUndefined();expect(w.outcome).toBe('active');
   maxGap=Math.max(maxGap,...sim.chainMetricsAll().map(m=>m.maxAnchorError));
  };
  for(let i=0;i<25;i++)step(1,true);
  // A leader cannot move the rear underneath the slower teammate/cable.
  expect(sim.generatedState()!.rearLimit).toBeLessThan(-5.5);
  // Keep this untimed retreat/contact fixture inside the protected spawn.
  // The old 75-tick launch coasted into v4 traffic while reversing.
  for(let i=0;i<30;i++)step(1);
  expect(sim.generatedState()!.rearLimit).toBeGreaterThan(-6.7);
  const at=sim.states().map(p=>p.position.z);expect(high).toBeGreaterThan(1);
  for(let i=0;i<360;i++)step(-1);
  expect(sim.states().every((p,i)=>p.position.z<at[i]!-1)).toBe(true);
  expect(Math.min(...sim.states().map(p=>p.position.z))-rear).toBeLessThan(.5);
  expect(maxGap).toBeLessThan(.01);
  // Drive forward off the contact without pose/velocity corrections.
  const contact=Math.min(...sim.states().map(p=>p.position.z));for(let i=0;i<30;i++)step(1);
  expect(Math.min(...sim.states().map(p=>p.position.z))).toBeGreaterThan(contact+1);
  sim.reset();expect(sim.generatedState()).toEqual(initial);
 }finally{sim.dispose();}
},30000);
