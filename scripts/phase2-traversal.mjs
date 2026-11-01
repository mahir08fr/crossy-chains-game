import {sectionCenter,hazardHalfDepth,railwaySettings} from '@crossy/config';
import {railwayTiming} from '@crossy/simulation';
import {roadCrossingClear,driverCrossingSpeed} from './fixtures/phase2-crossing.mjs';
/** Ordinary-input review driver: stop at each actual dry strip, recover exposure,
 * then independently time the next crossing. No body/velocity/time edits. */
export function traversalInput(snapshot,gate){
 const w=snapshot.world,p=snapshot.players,min=Math.min(...p.map(p=>p.position.z)),max=Math.max(...p.map(p=>p.position.z));
 const hazards=w.sections.filter(s=>s.type!=='grass');
 const next=hazards.find(s=>sectionCenter(s)+hazardHalfDepth(s)+.35>min);
 if(!next)return {gate,byPlayer:Object.fromEntries(p.map(p=>[p.id,1]))};
 const entry=sectionCenter(next)-hazardHalfDepth(next),exit=sectionCenter(next)+hazardHalfDepth(next);
 if(gate?.id!==next.id){
  // Before release approach the centre of the preceding level strip.
  const previous=hazards.filter(s=>s.index<next.index).at(-1);
  const stop=previous?(entry+sectionCenter(previous)+hazardHalfDepth(previous))/2:entry-1.5;
  const braking=Math.max(...p.map(p=>stoppingDistance(p.velocity.z)))+.06;
  if(max<stop-braking)return command(1,gate,p,min,w);
  if(p.some(p=>Math.abs(p.velocity.z)>.08)||w.water.players.some(p=>p.exposureSeconds>0))return command(0,gate,p,min,w);
  let clear=next.type==='river';
  if(next.type==='road')clear=roadCrossingClear(next,w.elapsedSeconds,p);
  if(next.type==='railway'){
   const t=railwayTiming({...railwaySettings,safeSeconds:next.safeSeconds}),local=w.elapsedSeconds%t.period;
   const until=local<t.arrival?t.arrival-local:t.period-local+t.arrival;
   clear=(local<t.arrival||local>t.clear+.03)&&until>(exit-min+.5)/driverCrossingSpeed+.6;
  }
  const following=hazards.find(s=>s.index>next.index);
  const stopAfter=following?(exit+sectionCenter(following)-hazardHalfDepth(following))/2:exit+2;
  return command(clear?1:0,clear?{id:next.id,stopAfter}:gate,p,min,w);
 }
 const braking=Math.max(...p.map(p=>stoppingDistance(p.velocity.z)))+.06;
 return command(max<gate.stopAfter-braking?1:0,gate,p,min,w);
}
function command(z,gate,p,min,w){const wet=w.water.players.some(p=>p.phase==='entering'||p.phase==='endangered');return {gate,byPlayer:Object.fromEntries(p.map(p=>[p.id,z&&p.position.z>min+(wet?.6:.15)?0:z*(wet?1:.65)]))};}

function stoppingDistance(v){v=Math.max(0,v);return v<=5.4?v*.3:(v*v-5.4*5.4)/36+1.62;}
