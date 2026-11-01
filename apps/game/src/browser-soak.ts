import { exerciseInput, exerciseScenarioIds, exerciseTicks } from '@crossy/simulation';
import type { FoundationSimulation, PlayerInputs } from '@crossy/simulation';

// Development-only real-time check through the actual application/render loop.
export class BrowserSoak {
  private active = false;
  private ticks = 0;
  private started = 0;
  private nextUpdate = 0;
  private maxExcess = 0;
  private maxPenetration = 0;
  private maxGeometries = 0;
  private maxTextures = 0;
  private maxContacts = 0;
  private readonly times: number[] = [];
  private readonly failures: string[] = [];
  private readonly onClick = () => this.active ? this.cancel() : this.start();

  constructor(private readonly button: HTMLButtonElement, private readonly panel: HTMLElement, private readonly loadScenario: (id: string) => void) {
    button.hidden = false;
    button.addEventListener('click', this.onClick);
  }

  get running(): boolean { return this.active; }

  private start(): void {
    this.ticks = this.maxExcess = this.maxPenetration = this.maxGeometries = this.maxTextures = this.maxContacts = 0;
    this.times.length = this.failures.length = 0;
    this.started = performance.now();
    this.active = true;
    this.button.textContent = 'Stop browser soak';
    this.button.blur();
    this.panel.hidden = false;
    this.show('Running');
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.button.textContent = 'Run 5 min browser soak';
    this.show('Cancelled');
  }

  input(): PlayerInputs | undefined {
    if (!this.active) return;
    const phase = this.ticks % exerciseTicks;
    const id = exerciseScenarioIds[Math.floor(this.ticks / exerciseTicks) % exerciseScenarioIds.length]!;
    if (phase === 0) this.loadScenario(id);
    return exerciseInput(id, phase);
  }

  record(simulation: FoundationSimulation, stepMs: number): void {
    if (!this.active) return;
    this.times.push(stepMs);
    if (simulation.fault) this.failures.push(simulation.fault.detail);
    else {
      this.ticks++;
      const metrics = simulation.chainMetrics()!;
      const contact = simulation.obstacleContacts();
      this.maxExcess = Math.max(this.maxExcess, metrics.excessRatio);
      this.maxPenetration = Math.max(this.maxPenetration, contact.maxPenetration);
      this.maxContacts = Math.max(this.maxContacts, contact.ids.length);
      if (simulation.world.bodies.len() !== 14 || simulation.world.impulseJoints.len() !== 13 || simulation.world.colliders.len() < 19 || simulation.world.colliders.len() > 21) this.failures.push('Unexpected physics counts');
      if (metrics.excessRatio >= 0.1 || contact.maxPenetration >= 0.03) this.failures.push('Geometric tolerance exceeded');
      if (this.ticks % exerciseTicks === 0 && contact.ids.length > 0) this.failures.push('Reverse sequence did not release contact');
    }
    if (this.failures.length || this.ticks >= 18_000) {
      this.active = false;
      this.button.textContent = 'Run 5 min browser soak';
      this.show(this.failures.length ? 'FAILED' : 'PASSED');
    } else if (performance.now() >= this.nextUpdate) {
      this.nextUpdate = performance.now() + 1000;
      this.show('Running (visible numeric test; hidden tab pauses)');
    }
  }

  resources(geometries: number, textures: number): void {
    if (!this.active) return;
    this.maxGeometries = Math.max(this.maxGeometries, geometries);
    this.maxTextures = Math.max(this.maxTextures, textures);
    if (geometries > 80 || textures > 8) {
      this.failures.push('Render resource bound exceeded');
      this.active = false;
      this.button.textContent = 'Run 5 min browser soak';
      this.show('FAILED');
    }
  }

  private show(status: string): void {
    const sorted = [...this.times].sort((a, b) => a - b);
    this.panel.textContent = [
      `Browser soak: ${status}`,
      `Active simulation ${(this.ticks / 60).toFixed(1)} / 300 s (${this.ticks} ticks)`,
      `Wall time ${((performance.now() - this.started) / 1000).toFixed(1)} s`,
      `Path excess max ${(this.maxExcess * 100).toFixed(3)}%; penetration ${(this.maxPenetration * 1000).toFixed(2)} mm`,
      `Simultaneous obstacles ${this.maxContacts}; geometry peak ${this.maxGeometries}; texture peak ${this.maxTextures}`,
      `p95 simulation step ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(3)} ms`,
      `Failures: ${this.failures.join('; ') || 'none'}`,
    ].join('\n');
  }

  dispose(): void { this.button.removeEventListener('click', this.onClick); }
}
