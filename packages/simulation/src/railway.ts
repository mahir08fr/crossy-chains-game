import RAPIER from '@dimforge/rapier3d-compat';
import { railwaySettings as rail, settings } from '@crossy/config';
import type { PlayerId, Point3 } from '@crossy/config';

export type RailwaySettings = { speed: number; direction: number; entryX: number; exitX: number; safeSeconds: number; warningSeconds: number; halfWidth: number; z: number; railTopY: number; finishZ: number; modules: readonly { offset: number; length: number; width: number; height: number }[] };
export type RailwayState = { elapsedSeconds: number; pass: number; x: number; signal: 'safe' | 'warning' | 'occupying'; dead: PlayerId[]; outcome: 'active' | 'failed' | 'cleared' };
const identity = { x: 0, y: 0, z: 0, w: 1 };
const boxes = new WeakMap<RailwaySettings['modules'][number], RAPIER.Cuboid>();
let playerCapsule: RAPIER.Capsule | undefined;
export function railwayPeriod(config: RailwaySettings = rail): number {
  return config.safeSeconds + (config.exitX - config.entryX) / config.speed;
}
/** Exact corridor times include the player radius and complete original consist.
 * The three-second warning leads first possible corridor impact, not departure. */
export function railwayTiming(config: RailwaySettings = rail): { warning: number; arrival: number; clear: number; period: number } {
  const front=Math.max(...config.modules.map(m=>m.offset+m.length/2));
  const tail=Math.min(...config.modules.map(m=>m.offset-m.length/2));
  const arrival=config.safeSeconds+(-config.halfWidth-settings.player.radius-config.entryX-front)/config.speed;
  const clear=config.safeSeconds+(config.halfWidth+settings.player.radius-config.entryX-tail)/config.speed;
  return {warning:arrival-config.warningSeconds,arrival,clear,period:railwayPeriod(config)};
}
/** Locomotive root. Reset occurs only when the complete consist is offscreen. */
export function railwayPose(time: number, config: RailwaySettings = rail): Pick<RailwayState, 'pass' | 'x' | 'signal'> {
  const period = railwayPeriod(config), pass = Math.floor((time + 1e-9) / period);
  const local = Math.max(0, time - pass * period);
  const along = config.entryX + Math.max(0, local - config.safeSeconds) * config.speed;
  let front = -Infinity, rear = Infinity;
  for (const m of config.modules) { front = Math.max(front, along + m.offset + m.length / 2); rear = Math.min(rear, along + m.offset - m.length / 2); }
  const occupying = front >= -config.halfWidth - settings.player.radius && rear <= config.halfWidth + settings.player.radius;
  const signal = occupying ? 'occupying' : local >= railwayTiming(config).warning && rear <= config.halfWidth + settings.player.radius ? 'warning' : 'safe';
  return { pass, x: along * config.direction, signal };
}

/** Relative-motion capsule/box cast, including initial overlap. No mesh collision or
 * periodic images: each call covers a continuous offscreen-to-offscreen passage. */
export function trainHitsPlayer(from: Point3, to: Point3, x: number, displacement: number, module: RailwaySettings['modules'][number], config: RailwaySettings = rail): boolean {
  const r = settings.player.radius;
  if (Math.min(from.z, to.z) > config.z + module.width / 2 + r || Math.max(from.z, to.z) < config.z - module.width / 2 - r) return false;
  const centerX = x + module.offset * config.direction, margin = module.length / 2 + r;
  if (Math.min(from.x, to.x) > Math.max(centerX, centerX + displacement) + margin
    || Math.max(from.x, to.x) < Math.min(centerX, centerX + displacement) - margin) return false;
  let box = boxes.get(module);
  if (!box) { box = new RAPIER.Cuboid(module.length / 2, module.height / 2, module.width / 2); boxes.set(module, box); }
  const capsule = playerCapsule ??= new RAPIER.Capsule(settings.player.halfHeight, r);
  const origin = { x: x + module.offset * config.direction, y: module.height / 2 + config.railTopY, z: config.z };
  return box.intersectsShape(origin, identity, capsule, from, identity) || !!box.castShape(origin, identity,
    { x: displacement, y: 0, z: 0 }, capsule, from, identity,
    { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 0, 1, true);
}

type Pose = { id: PlayerId; position: Point3 };
export class RailwayChallenge {
  private time = 0;
  private dead: PlayerId[] = [];
  private outcome: RailwayState['outcome'] = 'active';
  constructor(private readonly config: RailwaySettings = rail, elapsedSeconds = 0) {
    this.time = elapsedSeconds;
    if (!(config.speed > 0 && config.speed <= rail.maxSpeed) || ![1, -1].includes(config.direction)
      || config.warningSeconds < rail.minWarningSeconds || !Number.isFinite(config.safeSeconds) || config.safeSeconds<0
      || railwayTiming(config).warning<0 || railwayTiming(config).clear>=railwayPeriod(config)
      || config.entryX+Math.max(...config.modules.map(m=>m.offset+m.length/2))>=-config.halfWidth-settings.player.radius
      || config.exitX+Math.min(...config.modules.map(m=>m.offset-m.length/2))<=config.halfWidth+settings.player.radius) throw new Error('Invalid railway schedule');
  }
  get ended(): boolean { return this.outcome !== 'active'; }
  step(before: Pose[], after: Pose[], dt: number): void {
    if (this.ended || dt <= 0) return;
    const end = this.time + dt, period = railwayPeriod(this.config), struck = new Set<PlayerId>();
    // Split long diagnostic steps at departures/recycles; never cast the offscreen reset.
    for (let t = this.time; t < end - 1e-12;) {
      const pass = Math.floor((t + 1e-9) / period), base = pass * period;
      const boundary = t < base + this.config.safeSeconds - 1e-9 ? base + this.config.safeSeconds : base + period;
      const next = Math.min(end, boundary), pose = railwayPose(t, this.config);
      const moving = t >= base + this.config.safeSeconds - 1e-9;
      for (const p of before) {
        const target = after.find(a => a.id === p.id)!.position;
        const at = (time: number): Point3 => { const a = (time - this.time) / dt; return { x: p.position.x + (target.x - p.position.x) * a, y: p.position.y + (target.y - p.position.y) * a, z: p.position.z + (target.z - p.position.z) * a }; };
        const from = at(t), to = at(next);
        for (const module of this.config.modules) if (trainHitsPlayer(from, to, pose.x,
          moving ? (next - t) * this.config.speed * this.config.direction : 0, module, this.config)) struck.add(p.id);
      }
      t = next;
    }
    this.time = end;
    this.dead = [...struck].sort();
    if (this.dead.length) this.outcome = 'failed';
    else if (after.every(p => p.position.z - settings.player.radius >= this.config.finishZ)) this.outcome = 'cleared';
  }
  state(): RailwayState { return { elapsedSeconds: this.time, ...railwayPose(this.time, this.config), dead: [...this.dead], outcome: this.outcome }; }
}
