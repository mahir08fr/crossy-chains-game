import {traversalInput as phase2Traversal} from './phase2-traversal.mjs';
import {sectionCenter} from '@crossy/config';
import {inRiver} from '@crossy/simulation';
/** Retains original traffic/train waiting and shore recovery; adds ordinary
 * lateral regroup/current opposition for the new central rock corridor. */
export function traversalInput(snapshot,gate){
 const command=phase2Traversal(snapshot,gate),players=snapshot.players;
 return {...command,byPlayerX:Object.fromEntries(players.map((p,i)=>{
  const river=snapshot.world.sections.find(s=>s.river&&inRiver(p.position,{minZ:sectionCenter(s)-2.5,maxZ:sectionCenter(s)+2.5,halfWidth:s.halfWidth}));
  const counter=river?river.river.direction*(river.river.strength==='fast'?.22:.08):0;
  const target=(players.length-1)*.45-i*.9;
  return [p.id,Math.max(-.6,Math.min(.6,(target-p.position.x)*1.5-counter))];
 }))};
}
