import type { MotionRailway } from '@crossy/protocol';
export function railwayFeedback(state: MotionRailway): string {
  if (state.outcome === 'failed') return `Team failed · ${state.dead.join(', ').toUpperCase()} hit by train. Restart together.`;
  if (state.outcome === 'cleared') return 'Railway crossed together! Everyone reached safety.';
  if (state.signal === 'occupying') return 'TRAIN CROSSING · Stay behind the waiting line until it clears.';
  if (state.signal === 'warning') return 'TRAIN APPROACHING · Wait or retreat together. Amber lights warn before arrival.';
  return 'Cross together while clear. Green lights · keep the whole chain moving to the far line.';
}
