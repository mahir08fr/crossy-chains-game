import { beforeAll, expect, it } from 'vitest';
import { difficultyAt, generateSection, generatedScenario, groupScenario, sectionStart, sectionCenter, hazardHalfDepth, roadLanes, railwaySettings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { vehicleX } from './road.js';
import { railwayTiming } from './railway.js';
import { GeneratedWorld } from './generated-world.js';
beforeAll(initializePhysics);
it('streaming retains assigned difficulty; random-access reload reconstructs the identical section and clock',()=>{
 const w=new GeneratedWorld(42,4,['p1','p2','p3','p4'],()=>0,()=>{}),p={x:0,y:.8,z:250};
 w.stream([p]);const first=w.state();
 expect(new Set(first.sections.map(s=>s.difficultyTier)).size).toBeGreaterThan(1);
 const retained=first.sections.find(s=>s.start>250)!;
 w.progress([{...p,z:300}],1/60);w.stream([{...p,z:300}]);expect(w.state().sections.find(s=>s.id===retained.id)).toEqual(retained);
 w.stream([{...p,z:5000}]);w.stream([p]);expect(w.state().sections).toEqual(first.sections);
});
it.each([2,3,4] as const)('%i chained seats cross road and railway fixtures at each difficulty with ordinary forces',capacity=>{
 for(const tier of [0,1,2,3])for(const type of ['road','railway'] as const){
  const seed=type==='railway'&&tier<2?1:42;
  const section=Array.from({length:200},(_,i)=>generateSection(seed,i,capacity,undefined,difficultyAt(sectionStart(i)))).find(s=>s.difficultyTier===tier&&s.type===type);
  expect(section,`missing ${tier} ${type} fixture`).toBeDefined();
  if(!section)throw new Error('Missing required crossing fixture');
  const defs=groupScenario(generatedScenario,capacity).players.map(p=>({...p,spawn:{...p.spawn,z:section.start+.5}}));
  const sim=new FoundationSimulation(defs,[],true,[],false,false,false,seed);let released=false,crossed=false;
  try{
   for(let tick=0;tick<7200;tick++){
    const w=sim.generatedState()!,h=w.hazards.find(h=>h.id===section.id),poses=sim.states();
    if(!released&&tick>90){
     if(type==='railway'&&h?.railway){ const c={...railwaySettings,safeSeconds:section.safeSeconds}; const t=railwayTiming(c); const local=w.elapsedSeconds%t.period; if(local>=t.clear+.05 && local<t.clear+.25)released=true; }
     if(type==='road'&&h?.road){
      const minZ=Math.min(...poses.map(p=>p.position.z));
      released=roadLanes(section).every((lane,i)=>{
       const start=w.elapsedSeconds+Math.max(0,(lane.z-minZ-1.3)/6),end=w.elapsedSeconds+Math.max(0,(lane.z-minZ+1.8)/6)+.3;
       return lane.positions.every((_,slot)=>{
        const x=vehicleX(i,slot,start,roadLanes(section),3),delta=lane.speed*lane.direction*(end-start),half=1.77*.8+.6;
        return poses.every(p=>Math.ceil((p.position.x-half-Math.max(x,x+delta))/lane.period)>Math.floor((p.position.x+half-Math.min(x,x+delta))/lane.period));
       });
      });
     }
    }
    const min=Math.min(...poses.map(p=>p.position.z));
    sim.step(Object.fromEntries(poses.map(p=>[p.id,{x:0,z:released&&p.position.z<=min+.6?1:0}])));
    expect(sim.fault).toBeUndefined();expect(sim.generatedState()!.outcome).toBe('active');
    if(sim.states().every(p=>p.position.z>sectionCenter(section)+hazardHalfDepth(section)+.6)){crossed=true;break;}
   }
   expect(crossed,`${capacity} seats tier ${tier} ${section.id} ${type}`).toBe(true);
   expect(sim.chainMetricsAll().every(m=>m.maxAnchorError<.02)).toBe(true);
  }finally{sim.dispose();}
 }
},60000);
