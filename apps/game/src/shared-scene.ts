import { generatedScenario, groupScenario, railwayScenario, riverScenario, roadScenario } from '@crossy/config';
import type { GroupSize, SnapshotMessage } from '@crossy/protocol';
import { GameRenderer } from './renderer';
import { SnapshotBuffer } from './snapshot-buffer';

/** Shared display only: the original renderer/buffer; no physics or focus listeners. */
export class SharedScene {
  readonly renderer: GameRenderer;
  readonly buffer = new SnapshotBuffer();
  private snap = true;
  private cars: Promise<void> | undefined;
  constructor(viewport: HTMLElement, labelLayer: HTMLElement) {
    labelLayer.replaceChildren();
    this.renderer = new GameRenderer(viewport); this.renderer.setScenario(roadScenario);
    void this.renderer.loadGoose().catch(error => console.error('Character assets:', error));
  }
  push(snapshot: SnapshotMessage, now: number): boolean {
    const run = this.buffer.latest?.runGeneration;
    if (!this.buffer.push(snapshot, now)) return false;
    if (run !== snapshot.runGeneration) {
      this.renderer.setScenario(groupScenario(snapshot.world ? generatedScenario : snapshot.railway ? railwayScenario : snapshot.river ? riverScenario : roadScenario, snapshot.players.length as GroupSize));
      this.renderer.chain.setCount(snapshot.chain!.segments.length);
      this.renderer.chain.group.visible = !!snapshot.chain;
      for (const player of this.renderer.players.values()) player.reset();
      this.snap = true;
      if (snapshot.road && !this.cars) this.cars = this.renderer.traffic.load().catch(() => undefined);
    }
    this.renderer.observeSnapshot(snapshot);
    return true;
  }
  clear(): void { this.renderer.clearEffects(); this.buffer.clear(); this.snap = true; this.renderer.labels.resetNames(); }
  draw(now: number, elapsed: number): void {
    const presented = this.buffer.sample(now);
    if (presented) {
      const paused = presented.ageMs >= 250 || presented.snapshot.phase !== 'running';
      for (const p of presented.players) {
        const view = this.renderer.players.get(p.id)!;
        view.setDead((presented.world ?? presented.railway ?? presented.river ?? presented.road)?.dead.includes(p.id) ?? false);
        view.setWater((presented.world?.water ?? presented.river)?.players.find(w => w.id === p.id), (presented.world?.water ?? presented.river)?.exposureLimitSeconds);
        view.update(p.position, p.velocity, elapsed, p.grounded, paused);
      }
      if (presented.chain) this.renderer.chain.update(presented.chain.segments, presented.chain.segments, 1);
      if (presented.world) this.renderer.generated.update(presented.world);
      if (presented.railway) this.renderer.railway.update(presented.railway);
      if (presented.road) this.renderer.traffic.update(presented.road);
      // Include cable contacts as well as all players; authored camera keeps +Z look-ahead.
      this.renderer.camera.update([...presented.players.map(p => p.position), ...(presented.chain?.segments.map(p => p.position) ?? [])], elapsed, this.snap, presented.world);
      this.snap = false;

    }
    this.renderer.draw();
  }
  dispose(): void { this.clear(); this.renderer.dispose(); }
}
