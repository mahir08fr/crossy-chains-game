import { difficultyTiers } from '@crossy/config';
import type { EndlessRun, MotionWorld, RoomPhase } from '@crossy/protocol';
import { waterFeedback } from './water-feedback';
export function generatedFeedback(world: MotionWorld, phase: RoomPhase, run?: EndlessRun): string {
  const score = run ? `${phase === 'ended' ? 'Final' : 'Team'} ${run.distance.toFixed(1)} m · ${difficultyTiers[run.difficultyTier]!.label} · Room best ${run.roomBest.toFixed(1)} m${phase === 'ended' ? ` · Previous best ${run.previousBest.toFixed(1)} m${run.newRecord ? ' · New room record!' : ''} · Survived ${world.elapsedSeconds.toFixed(1)} s` : ''} · ` : '';
  const identity=`Seed ${world.seed} · generator v${world.version} · sections ${world.sections[0]?.index}…${world.sections.at(-1)?.index}`;
  if(world.outcome==='failed')return `${score}Team failed · ${world.dead.join(', ').toUpperCase()} hit or exhausted water time. Every player votes to restart the same seed. · ${identity}`;
  const warning=world.hazards.some(h=>h.railway?.signal==='warning'||h.railway?.signal==='occupying')?' · Watch railway lamps; wait on grass.':'';
  const wet=world.water.players.some(p=>p.phase!=='safe')?` · ${waterFeedback(world.water)}`:'';
  if (phase === 'fault') return `${score}Physics safety stop. Every player votes to restart. · ${identity}`;
  if (phase === 'waiting') return `${score}Choose Ready on every device; host starts. · ${identity}`;
  return `${score}${identity} · Move forward together; regroup on grass.${warning}${wet}${phase==='paused'?' · Team paused safely.':''}`;
}
