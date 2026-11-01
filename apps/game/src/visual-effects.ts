import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry, Vector3 } from 'three';
import { riverSettings } from '@crossy/config';
import type { PlayerSlot, Point3, SnapshotMessage } from '@crossy/protocol';

export type EffectKind = 'entry' | 'exit' | 'car' | 'train';
export type VisualEvent = { kind: EffectKind; slot: PlayerSlot; position: Point3 };
const wet = (phase: string) => phase === 'entering' || phase === 'endangered';

/** Consumes accepted authority snapshots, never mesh/animation/proximity guesses.
 * Reconstruction and gaps >= the existing safety window prime silently. */
export class VisualEventTracker {
  private previous: SnapshotMessage | undefined;
  private readonly lastSplash = new Map<PlayerSlot, number>();
  reset(): void { this.previous = undefined; this.lastSplash.clear(); }
  observe(next: SnapshotMessage): VisualEvent[] {
    const before = this.previous;
    if (before && (next.runGeneration < before.runGeneration || next.runGeneration === before.runGeneration && next.serverTimeMs <= before.serverTimeMs)) return [];
    this.previous = next;
    if (!before || next.runGeneration !== before.runGeneration || next.serverTimeMs - before.serverTimeMs >= 250
      || before.phase !== 'running' || !['running','ended'].includes(next.phase)) {
      this.lastSplash.clear(); return [];
    }
    const events: VisualEvent[] = [];
    for (const player of next.players) {
      const priorWater = (before.world?.water ?? before.river)?.players.find(p => p.id === player.id);
      const water = (next.world?.water ?? next.river)?.players.find(p => p.id === player.id);
      if (next.phase === 'running' && priorWater && water && water.phase !== 'failed' && priorWater.phase !== 'failed'
        && wet(priorWater.phase) !== wet(water.phase)
        && next.serverTimeMs - (this.lastSplash.get(player.id) ?? -Infinity) >= 300) {
        events.push({ kind: wet(water.phase) ? 'entry' : 'exit', slot: player.id,
          position: { ...player.position, y: riverSettings.surfaceY + .04 } });
        this.lastSplash.set(player.id, next.serverTimeMs);
      }
      if (next.phase !== 'ended') continue;
      const hit = (s: SnapshotMessage, kind: 'car'|'train') => kind === 'car'
        ? s.road?.dead.includes(player.id) || s.world?.hazards.some(h => h.road?.dead.includes(player.id))
        : s.railway?.dead.includes(player.id) || s.world?.hazards.some(h => h.railway?.dead.includes(player.id));
      for (const kind of ['car','train'] as const) if (hit(next, kind) && !hit(before, kind)) {
        events.push({ kind, slot: player.id, position: { ...player.position } });
        break; // At most one localized burst per victim, including mixed team failures.
      }
    }
    return events;
  }
}

export const effectLimits = { bursts: 16, particlesPerBurst: 14, lifetime: .72 } as const;
type Burst = { active: boolean; age: number; kind: EffectKind; x: number; y: number; z: number };

/** One shared opaque eight-triangle particle, one material, one instanced draw.
 * Fixed CPU/GPU storage; completed particles shrink away. No physics/RAF/timers. */
export class VisualEffects {
  readonly group = new Group();
  readonly particles = new InstancedMesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial({ toneMapped: false }), effectLimits.bursts * effectLimits.particlesPerBurst);
  private readonly bursts: Burst[] = Array.from({ length: effectLimits.bursts }, () => ({ active: false, age: 0, kind: 'entry', x: 0, y: 0, z: 0 }));
  private readonly matrix = new Matrix4();
  private readonly color = new Color();
  private readonly scale = new Vector3();
  private disposed = false;
  private created = 0;
  private dropped = 0;
  private peak = 0;
  constructor() {
    this.particles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.particles.frustumCulled = false; this.particles.count = 0;
    this.group.name = 'temporary-visual-effects'; this.group.visible = false;
    this.group.add(this.particles);
    // Allocate the colour buffer once, before any effect reaches the GPU.
    this.particles.setColorAt(0, this.color);
  }
  emit(event: VisualEvent, reduced = false): boolean {
    if (this.disposed || reduced) return false;
    const burst = this.bursts.find(b => !b.active);
    if (!burst) { this.dropped++; return false; }
    Object.assign(burst, { active: true, age: 0, kind: event.kind, x: event.position.x, y: event.position.y, z: event.position.z });
    this.created++; return true;
  }
  update(seconds: number): void {
    if (this.disposed) return;
    let count = 0, active = 0;
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.age += Math.max(0, seconds);
      const splash = b.kind === 'entry' || b.kind === 'exit', exit = b.kind === 'exit';
      const lifetime = splash ? (exit ? .44 : .58) : effectLimits.lifetime;
      if (b.age >= lifetime) { b.active = false; continue; }
      active++;
      const n = splash ? (exit ? 6 : 9) : b.kind === 'train' ? 14 : 10;
      const t = b.age, fade = Math.min(1, (lifetime-t)/.18), strength = b.kind === 'train' ? 1.18 : exit ? .65 : 1;
      for (let i = 0; i < n; i++) {
        const angle = i * Math.PI * 2 / n + .35;
        const speed = (splash ? 1.2 : 1.9) * strength * (1 + (i%3)*.16);
        const radius = (splash ? .24 : .12) + speed*t;
        const y = b.y + (splash ? 1.65 : 2.1)*strength*t - (splash ? 3.6 : 4.2)*t*t;
        const size = (splash ? .065 : .095)*strength*fade;
        this.matrix.makeRotationY(angle + t*4);
        this.matrix.scale(this.scale.set(size*.7,size*(splash?1.5:1),size));
        this.matrix.setPosition(b.x+Math.cos(angle)*radius, Math.max(b.y+.015,y), b.z+Math.sin(angle)*radius);
        this.particles.setMatrixAt(count, this.matrix);
        this.color.setHex(splash ? (i%2 ? 0x74c7ce : 0xb5e6dc) : (i%3 ? 0xf5cc78 : 0xfff1c7));
        this.particles.setColorAt(count++, this.color);
      }
    }
    this.peak = Math.max(this.peak, active);
    this.group.visible = count > 0; this.particles.count = count;
    if (count) { this.particles.instanceMatrix.needsUpdate = true; this.particles.instanceColor!.needsUpdate = true; }
  }
  metrics() { return { active: this.bursts.filter(b => b.active).length, particles: this.particles.count, peak: this.peak, created: this.created, dropped: this.dropped, capacity: effectLimits.bursts, particleCapacity: this.particles.instanceMatrix.count }; }
  clear(): void { for (const b of this.bursts) b.active = false; this.particles.count = 0; this.group.visible = false; }
  dispose(): void {
    if (this.disposed) return; this.clear(); this.disposed = true;
    this.particles.dispose(); this.particles.geometry.dispose(); this.particles.material.dispose(); this.group.removeFromParent(); this.group.clear();
  }
}
