import { riverSettings as water, settings } from '@crossy/config';
import type { PlayerId, Point3 } from '@crossy/config';

export type WaterPhase = 'safe' | 'entering' | 'endangered' | 'recovering' | 'failed';
export type WaterPlayer = { id: PlayerId; phase: WaterPhase; exposureSeconds: number; safeSeconds: number };
export type RiverState = { exposureLimitSeconds: number; recoverySeconds: number; players: WaterPlayer[]; dead: PlayerId[]; outcome: 'active' | 'failed' | 'cleared' };
export type RiverPlayer = { id: PlayerId; position: Point3; grounded: boolean };
/** Capsule/volume overlap; touching the exact boundary is conservatively wet. */
export type WaterVolume = { minZ: number; maxZ: number; halfWidth: number };
export function inRiver(p: Point3, volume: WaterVolume = water): boolean {
  const r = settings.player.radius;
  return Math.abs(p.x) <= volume.halfWidth + r && p.z + r >= volume.minZ && p.z - r <= volume.maxZ
    && p.y - settings.player.halfHeight - r <= water.surfaceY && p.y + settings.player.halfHeight + r >= -water.depth;
}
export function safeRiverGround(player: RiverPlayer): boolean {
  const p = player.position, margin = settings.player.radius + water.safeMargin;
  return player.grounded && Math.abs(p.x) <= water.halfWidth - margin
    && (p.z + margin < water.minZ || p.z - margin > water.maxZ)
    && p.y - settings.player.halfHeight - settings.player.radius >= -0.05;
}
/** Only called after authoritative substeps. Pauses never call this clock. */
export class RiverChallenge {
  private readonly players: WaterPlayer[];
  private outcome: RiverState['outcome'] = 'active';
  constructor(ids: readonly PlayerId[], private readonly wet: (p: Point3) => boolean = inRiver, private readonly safe: (p: RiverPlayer) => boolean = safeRiverGround, private readonly finishZ = water.finishZ as number) {
    this.players = ids.map(id => ({ id, phase: 'safe', exposureSeconds: 0, safeSeconds: 0 }));
  }
  get ended(): boolean { return this.outcome !== 'active'; }
  step(poses: RiverPlayer[], dt: number): void {
    if (this.ended) return;
    for (const state of this.players) {
      const player = poses.find(p => p.id === state.id)!;
      if (this.wet(player.position)) {
        const first = state.phase === 'safe' || state.phase === 'recovering';
        state.safeSeconds = 0;
        state.exposureSeconds = Math.min(water.exposureSeconds, state.exposureSeconds + dt);
        state.phase = state.exposureSeconds >= water.exposureSeconds - 1e-9 ? 'failed' : first ? 'entering' : 'endangered';
      } else if (state.exposureSeconds > 0) {
        state.phase = 'recovering';
        state.safeSeconds = this.safe(player) ? Math.min(water.recoverySeconds, state.safeSeconds + dt) : 0;
        if (state.safeSeconds >= water.recoverySeconds - 1e-9) {
          state.phase = 'safe'; state.exposureSeconds = 0; state.safeSeconds = 0;
        }
      }
    }
    if (this.players.some(p => p.phase === 'failed')) this.outcome = 'failed';
    else if (this.players.every(p => p.phase === 'safe') && poses.every(p => this.safe(p) && p.position.z - settings.player.radius >= this.finishZ)) this.outcome = 'cleared';
  }
  state(): RiverState {
    return { exposureLimitSeconds: water.exposureSeconds, recoverySeconds: water.recoverySeconds, players: this.players.map(p => ({ ...p })), dead: this.players.filter(p => p.phase === 'failed').map(p => p.id), outcome: this.outcome };
  }
}
