import type { MotionRiver } from '@crossy/protocol';
export function waterFeedback(river: MotionRiver): string {
  if (river.outcome === 'failed') return `Team failed · ${river.dead.join(', ').toUpperCase()} exhausted water time. Host can restart the team.`;
  if (river.outcome === 'cleared') return 'River crossed together! Host can restart.';
  return river.players.map(p => `${p.id.toUpperCase()}: ${p.phase === 'safe' ? 'safe' : `${p.phase}${p.phase === 'recovering' ? ' · stay ashore' : ''}`}`).join(' | ')
    + ' · Watch survival rings. Pull from land; stay fully ashore to recover.';
}
