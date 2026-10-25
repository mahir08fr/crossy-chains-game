import { beforeAll, expect, it } from 'vitest';
import { generateSection, groupScenario, generatedScenario, riverRockBoxes, riverRockSizes, sectionCenter, riverSettings, riverScenario } from '@crossy/config';
import type { GroupSize } from '@crossy/config';
import { initializePhysics, FoundationSimulation } from './simulation.js';
import { GeneratedWorld } from './generated-world.js';
beforeAll(initializePhysics);
const rivers=(seed:number)=>Array.from({length:100},(_,i)=>generateSection(seed,i)).filter(s=>s.river);
function simulation(seed:number,capacity:GroupSize,z:number,spread=.9,x=0){
 const defs=groupScenario(generatedScenario,capacity).players.map((p,i)=>({...p,spawn:{x:x+(capacity-1)*spread/2-i*spread,y:.8,z}}));
 return new FoundationSimulation(defs,[],true,[],false,false,false,seed);
}
it('currents are confined to actual wet volumes and authority snapshots cannot mutate recipes',()=>{
 const w=new GeneratedWorld(1,4,['p1','p2','p3','p4'],()=>0,()=>{});w.stream([{x:0,y:.8,z:0}]);
 const s=w.state().sections.find(s=>s.river)!;expect(s).toBeDefined();const z=sectionCenter(s),original=structuredClone(s.river!);
 expect(w.current({x:0,y:.47,z})).toBe(original.direction*original.acceleration);
 expect(w.current({x:0,y:.77,z:z-3})).toBe(0);expect(w.current({x:0,y:3,z})).toBe(0);
 s.river!.rocks[0]!.x=0;s.river!.direction=original.direction===1?-1:1;
 expect(w.state().sections.find(a=>a.id===s.id)!.river).toEqual(original);
 w.stream([{x:0,y:.8,z:1200}]);w.stream([{x:0,y:.8,z:0}]);expect(w.state().sections.find(a=>a.id===s.id)!.river).toEqual(original);
});
// Start upstream of the central corridor so this measures free drift before rock contact.
it('left/right forces drift physically, fast is stronger, and replay is exact',()=>{
 const measured:Record<string,number>={};
 for(const strength of ['normal','fast'] as const)for(const direction of [-1,1]){
  let seed=0,s;while(seed<100){s=rivers(seed).find(s=>s.river!.strength===strength&&s.river!.direction===direction);if(s)break;seed++;}
  expect(s).toBeDefined();const sim=simulation(seed,2,sectionCenter(s!),.9,-direction*1.5);
  try{
   const run=()=>{for(let i=0;i<120;i++)sim.step({});return sim.states();};const poses=run();
   expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.water.players.every(p=>p.exposureSeconds>1.9)).toBe(true);
   const drift=poses.reduce((a,p)=>a+p.velocity.x,0)/2;expect(drift*direction).toBeGreaterThan(.02);measured[`${strength}:${direction}`]=Math.abs(drift);
   sim.reset();expect(run()).toEqual(poses);
  }finally{sim.dispose();}
 }
 expect(measured['fast:-1']!).toBeGreaterThan(measured['normal:-1']!*2);expect(measured['fast:1']!).toBeGreaterThan(measured['normal:1']!*2);
});
// Upstream steering is deliberate player input, retuned for stronger currents;
// exposure, recovery, contact and fault assertions remain unchanged.
it.each([2,3,4] as const)('%i seats cross fast left/right rivers with margin, recover ashore and reset resources',capacity=>{
 for(const direction of [-1,1]){
  let seed=0,s;while(seed<100){s=rivers(seed).find(s=>s.river!.strength==='fast'&&s.river!.direction===direction);if(s)break;seed++;}
  const sim=simulation(seed,capacity,sectionCenter(s!)-4);
  try{
   const initial=sim.generatedState(),count=sim.world.colliders.len();let maxExposure=0;
   for(let tick=0;tick<600;tick++){
    const min=Math.min(...sim.states().map(p=>p.position.z));
    sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:-direction*.6,z:p.position.z<min+.35?1:0}])));
    maxExposure=Math.max(maxExposure,...sim.generatedState()!.water.players.map(p=>p.exposureSeconds));
    if(sim.states().every(p=>p.position.z>sectionCenter(s!)+3.4)&&sim.generatedState()!.water.players.every(p=>p.phase==='safe'))break;
   }
   expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('active');expect(maxExposure).toBeLessThan(7);
   expect(sim.generatedState()!.water.players.every(p=>p.phase==='safe')).toBe(true);expect(sim.states().every(p=>p.position.z>sectionCenter(s!)+3.4)).toBe(true);
   expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.03)).toBe(true);
   sim.reset();expect(sim.generatedState()).toEqual(initial);expect(sim.world.colliders.len()).toBe(count);
  }finally{sim.dispose();}
 }
});
it.each(['small','medium'] as const)('%s rocks obstruct players without supporting ground or clearing exposure',size=>{
 const s=rivers(1)[0]!,rock=s.river!.rocks.find(r=>r.size===size)!,d=riverRockSizes[size];
 const sim=simulation(1,2,rock.z-d.halfZ-1,.9,rock.x);
 try{
  for(let i=0;i<300;i++)sim.step({p1:{x:(rock.x-sim.state('p1').position.x)*2-s.river!.direction*s.river!.acceleration*.12/riverSettings.speed,z:1},p2:{x:(rock.x-sim.state('p2').position.x)*2-s.river!.direction*s.river!.acceleration*.12/riverSettings.speed,z:1}});
  expect(sim.fault).toBeUndefined();expect(sim.states().every(p=>p.position.z<rock.z-d.halfZ+.03)).toBe(true);
  expect(sim.generatedState()!.water.players.every(p=>p.exposureSeconds>3)).toBe(true);
  const shapes=riverRockBoxes(s.river!);expect(shapes.every(b=>b.center.y-b.halfSize.y< -riverSettings.depth)).toBe(true);
  for(let i=0;i<300;i++)sim.step({});expect(sim.generatedState()!.outcome).toBe('failed');
 }finally{sim.dispose();}
});
it.each([2,3,4] as const)('%i-seat physical cables catch both rock sizes and release by reversing with bounded constraints',capacity=>{
 for(const size of ['small','medium'] as const){
  let seed=0,s,rock;
  while(seed<100){s=rivers(seed)[0];rock=s?.river!.rocks.find(r=>r.size===size&&Math.abs(r.x)<4);if(rock)break;seed++;}
  expect(rock).toBeDefined();
  const centered={...s!.river!,rocks:s!.river!.rocks.map(r=>({...r,x:r.x-rock!.x,z:r.z-rock!.z+4.5}))};
  const defs=groupScenario(riverScenario,capacity).players.map((p,i)=>({...p,spawn:{x:i===0?2:-2*i,y:.8,z:.7}}));
  const sim=new FoundationSimulation(defs,[...riverScenario.boxes,...riverRockBoxes(centered)],true,[],false,true);
  try{
   let contacts=0,maxPenetration=0,maxAnchor=0,maxSpeed=0;
   for(let i=0;i<180;i++){
    sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:0,z:1}])));
    const c=sim.obstacleContacts();if(c.ids.includes(rock!.id))contacts++;
    maxPenetration=Math.max(maxPenetration,c.maxPenetration);maxAnchor=Math.max(maxAnchor,...sim.chainMetricsAll().map(m=>m.maxAnchorError));
    maxSpeed=Math.max(maxSpeed,...[...sim.states(),...sim.chainStates()].map(p=>Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z)));
   }
   expect(contacts).toBeGreaterThan(10);expect(maxPenetration).toBeLessThan(.03);expect(maxAnchor).toBeLessThan(.03);expect(maxSpeed).toBeLessThan(15);
   for(let i=0;i<180;i++)sim.step(Object.fromEntries(sim.states().map(p=>[p.id,{x:0,z:-1}])));
   expect(sim.fault).toBeUndefined();expect(sim.riverState()!.outcome).toBe('active');expect(sim.obstacleContacts().ids).not.toContain(rock!.id);
   expect(sim.states().every(p=>p.position.z<3.5)).toBe(true);
  }finally{sim.dispose();}
 }
});
it.each([2,3,4] as const)('%i seats: dry teammates physically pull a wet player against fast-current load',capacity=>{
 let seed=0,s;for(;seed<100;seed++){s=generateSection(seed,1);if(s.river?.strength==='fast')break;}
 expect(s?.river).toBeDefined();const z=sectionCenter(s!);
 const defs=groupScenario(generatedScenario,capacity).players.map((p,i)=>({...p,spawn:{x:(i-1)*1.2,y:.8,z:z+(i===1?1:-4)}}));
 const sim=new FoundationSimulation(defs,[],true,[],false,false,false,seed);
 try{
  let exposure=0;
  for(let tick=0;tick<360;tick++){
   sim.step(Object.fromEntries(defs.map(p=>[p.id,{x:0,z:p.id==='p2'?0:-1}])));
   exposure=Math.max(exposure,sim.generatedState()!.water.players[1]!.exposureSeconds);
  }
  expect(exposure).toBeGreaterThan(.5);expect(exposure).toBeLessThan(7);expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('active');
  expect(sim.generatedState()!.water.players[1]!.phase).toBe('safe');expect(sim.state('p2').position.z).toBeLessThan(z-3);
  expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.03)).toBe(true);
 }finally{sim.dispose();}
});
it.each([2,3,4] as const)('%i seats cross consecutive seeded rivers with a full safe-bank recovery between them',capacity=>{
 const a=generateSection(2,4),b=generateSection(2,5);expect(a.type).toBe('river');expect(b.type).toBe('river');
 const sim=simulation(2,capacity,sectionCenter(a)-4);
 try{
  for(const section of [a,b]){
   const target=sectionCenter(section)+4.3;let recovered=false;
   for(let tick=0;tick<600;tick++){
    const min=Math.min(...sim.states().map(p=>p.position.z)),water=sim.generatedState()!.water;
    sim.step(Object.fromEntries(sim.states().map((p,i)=>{
     const wet=water.players[i]!.phase==='entering'||water.players[i]!.phase==='endangered';
     return [p.id,{x:Math.max(-.6,Math.min(.6,((capacity-1)*.45-i*.9-p.position.x)*1.5-(wet?section.river!.direction*(section.river!.strength==='fast'?.22:.08):0))),z:p.position.z>min+.3?0:Math.max(0,Math.min(1,(target-p.position.z)*2))}];
    })));
    if(sim.states().every(p=>p.position.z>target-.2)&&sim.generatedState()!.water.players.every(p=>p.phase==='safe')){recovered=true;break;}
   }
   expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('active');expect(recovered).toBe(true);
  }
 }finally{sim.dispose();}
});
