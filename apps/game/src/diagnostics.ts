import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Scene } from 'three';
import type { FoundationSimulation, PlayerState } from '@crossy/simulation';

export class Diagnostics {
  private readonly lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
  private enabled = false;
  private fps = 60;
  private nextUpdate = 0;

  constructor(private readonly scene: Scene, private readonly panel: HTMLElement, private readonly button: HTMLButtonElement) {
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    scene.add(this.lines);
    button.hidden = false;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.lines.visible = this.enabled;
    this.panel.hidden = !this.enabled;
    this.button.setAttribute('aria-pressed', String(this.enabled));
  }

  update(simulation: FoundationSimulation, states: readonly PlayerState[], elapsed: number, time: number, stepMs: number, dropped: number): void {
    if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * 0.05;
    if (!this.enabled) return;
    const { vertices, colors } = simulation.fault ? { vertices: new Float32Array(), colors: new Float32Array() } : simulation.debugLines();
    this.lines.geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.lines.geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
    if (time < this.nextUpdate) return;
    this.nextUpdate = time + 150;
    const chain = simulation.fault ? undefined : simulation.chainMetrics();
    const contacts = simulation.fault ? { ids: [], pairs: 0, maxPenetration: 0 } : simulation.obstacleContacts();
    this.panel.textContent = [
      `FPS           ${this.fps.toFixed(0)}`,
      `Physics       60 Hz / ${Math.round((1 / 60) / simulation.world.timestep)} substeps / ${stepMs.toFixed(2)} ms last batch`,
      `Fault         ${simulation.fault?.detail ?? "none"}`,
      `Tick          ${states[0]?.tick ?? 0}`,
      ...states.flatMap(({ id, position: p, velocity: v, grounded }) => [
        `${id} position   ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
        `${id} velocity   ${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`,
        `${id} grounded   ${grounded ? 'yes' : 'no'}`,
      ]),
      `Dropped time  ${dropped.toFixed(2)} s`,
      `Bodies        ${simulation.world.bodies.len()}`,
      `Colliders     ${simulation.world.colliders.len()}`,
      `Joints        ${simulation.world.impulseJoints.len()}`,
      ...(chain ? [
        `Rest length   ${chain.restLength.toFixed(3)} m`,
        `End distance  ${chain.endpointDistance.toFixed(3)} m`,
        `Path + gaps   ${chain.effectivePathLength.toFixed(3)} m`,
        `Anchor gaps   max ${chain.maxAnchorError.toFixed(4)} / sum ${chain.totalAnchorError.toFixed(4)} m`,
        `Obstacle hits ${contacts.ids.join(", ") || "none"} / ${contacts.pairs} pairs`,
        `Penetration   ${(contacts.maxPenetration * 1000).toFixed(2)} mm`,
        `Path excess   ${(chain.excessRatio * 100).toFixed(2)}% (geometric; not force)`,
      ] : []),
    ].join('\n');
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
