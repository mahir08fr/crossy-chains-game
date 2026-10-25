import { difficultyAt, difficultyVersion } from '@crossy/config';
import type { EndlessRun, MotionPlayer } from '@crossy/protocol';

/** Room-owned score. Only authoritative fixed-step poses enter this object. */
export class EndlessRunScore {
  private distance = 0;
  private best = 0;
  private previousBest = 0;
  private finished = false;
  advance(players: readonly Pick<MotionPlayer, 'position'>[], failed: boolean): void {
    if (this.finished || players.length < 2) return;
    let trailing = Infinity;
    for (const player of players) trailing = Math.min(trailing, player.position.z);
    this.distance = Math.max(this.distance, trailing, 0);
    if (failed) { this.finished = true; this.best = Math.max(this.best, this.distance); }
  }
  reset(): void {
    this.distance = 0; this.previousBest = this.best; this.finished = false;
  }
  state(): EndlessRun {
    return { distance: this.distance, roomBest: this.best, previousBest: this.previousBest,
      newRecord: this.finished && this.distance > this.previousBest,
      difficultyTier: difficultyAt(this.distance), difficultyVersion };
  }
}
