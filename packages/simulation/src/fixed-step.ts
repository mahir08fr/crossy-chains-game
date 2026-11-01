export class FixedStepClock {
  private accumulated = 0;
  droppedSeconds = 0;

  constructor(readonly stepSeconds: number, readonly maxTicks: number) {}

  advance(elapsed: number, step: () => void): number {
    if (!Number.isFinite(elapsed) || elapsed < 0) return this.alpha;
    const accepted = Math.min(elapsed, this.stepSeconds * this.maxTicks);
    this.droppedSeconds += elapsed - accepted;
    this.accumulated += accepted;
    let ticks = 0;
    while (this.accumulated + 1e-10 >= this.stepSeconds && ticks < this.maxTicks) {
      step();
      this.accumulated = Math.max(0, this.accumulated - this.stepSeconds);
      ticks++;
    }
    return this.alpha;
  }

  get alpha(): number {
    return this.accumulated / this.stepSeconds;
  }

  reset(): void {
    this.accumulated = 0;
    this.droppedSeconds = 0;
  }
}
