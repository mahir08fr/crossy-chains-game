import { generateSection, generatedScenario, groupScenario, roadLanes, wrapTrafficX } from '@crossy/config';
import type { MotionWorld } from '@crossy/protocol';
import type { GameRenderer } from './renderer';

/** Static real environment, with no simulation, room, timer or decorative physics. */
export function setMenuScene(renderer: GameRenderer): void {
  renderer.setScenario(groupScenario(generatedScenario,2));
  renderer.boundaryShading.amount.value = 0;
  renderer.chain.group.visible = false;
  for (const player of renderer.players.values()) player.group.visible = false;
  renderer.labels.setPresent([]);
  const seed = 1, sections = Array.from({length:7},(_,i)=>generateSection(seed,i-1));
  const world: MotionWorld = { version:4,riverVersion:1,highWater:16,rearLimit:9,seed,elapsedSeconds:0,sections,
    hazards:sections.flatMap<MotionWorld['hazards'][number]>(s=>s.type==='road'?[{id:s.id,road:{elapsedSeconds:0,vehicles:roadLanes(s).flatMap((lane,i)=>lane.positions.map((offset,slot)=>({id:roadLanes(s).slice(0,i).reduce((n,l)=>n+l.positions.length,0)+slot,lane:i,x:wrapTrafficX(lane.offset+offset,lane.period)}))),dead:[],outcome:'active'}}]:[]),
    water:{exposureLimitSeconds:8,recoverySeconds:1,players:[],dead:[],outcome:'active'},dead:[],outcome:'active'};
  renderer.generated.update(world); renderer.camera.update([{x:0,y:0,z:16}],0,true,world);
}
