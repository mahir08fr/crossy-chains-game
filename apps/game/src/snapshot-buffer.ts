import { roadLanes } from '@crossy/config';
import type { MotionWorld, MotionRailway, MotionRiver, MotionRoad, MotionChain, MotionPlayer, Point3, Rotation4, SnapshotMessage } from '@crossy/protocol';

const lerpPoint = (a: Point3, b: Point3, alpha: number): Point3 => ({
  x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha,
});
/** Only interpolate increasing exposure within two running authoritative frames.
 * Recovery resets and phase transitions remain step changes; never anticipate a refill. */
function interpolateWater(a: MotionRiver,b: MotionRiver,alpha:number,running:boolean): MotionRiver {
  if(!running)return a;
  return {...a,players:a.players.map(p=>{
    const next=b.players.find(n=>n.id===p.id);
    return next && next.exposureSeconds>=p.exposureSeconds && (p.phase==='entering'||p.phase==='endangered')
      ? {...p,exposureSeconds:p.exposureSeconds+(next.exposureSeconds-p.exposureSeconds)*alpha}:p;
  })};
}
// Shortest-path spherical interpolation is presentation only, independent of physics/Three.js.
function slerp(a: Rotation4, b: Rotation4, alpha: number): Rotation4 {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  const theta = Math.acos(dot), sine = Math.sin(theta);
  const wa = sine < 1e-6 ? 1 - alpha : Math.sin((1 - alpha) * theta) / sine;
  const wb = sign * (sine < 1e-6 ? alpha : Math.sin(alpha * theta) / sine);
  const q = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb,
    z: a.z * wa + b.z * wb, w: a.w * wa + b.w * wb };
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / norm, y: q.y / norm, z: q.z / norm, w: q.w / norm };
}
export type PresentedSnapshot = {
  players: MotionPlayer[];
  chain?: MotionChain;
  world?: MotionWorld;
  road?: MotionRoad;
  railway?: MotionRailway;
  river?: MotionRiver;
  snapshot: SnapshotMessage;
  ageMs: number;
  holding: boolean;
};

/** A bounded shared timeline for both players. Holds on underrun; never predicts physics. */
export class SnapshotBuffer {
  private frames: SnapshotMessage[] = [];
  private receivedAt = 0;
  private clockOffset: number | undefined;
  private bestRtt = Infinity;
  private clockMeasuredAt = 0;
  private renderedAt: number | undefined;

  constructor(readonly delayMs = 75, readonly capacity = 32) {}
  get latest(): SnapshotMessage | undefined { return this.frames.at(-1); }
  get size(): number { return this.frames.length; }
  ageMs(now: number): number {
    const latest = this.latest;
    if (!latest || this.clockOffset === undefined) return Infinity;
    return Math.max(0, now - this.receivedAt, now + this.clockOffset - latest.serverTimeMs);
  }

  push(snapshot: SnapshotMessage, now: number): boolean {
    const previous = this.latest;
    if (previous && (snapshot.runGeneration < previous.runGeneration
      || (snapshot.runGeneration === previous.runGeneration
        && (snapshot.tick < previous.tick || snapshot.serverTimeMs <= previous.serverTimeMs)))) return false;
    if (previous && snapshot.runGeneration !== previous.runGeneration) {
      this.frames = [];
      this.renderedAt = undefined;
    }
    if (previous && snapshot.runGeneration === previous.runGeneration
      && (snapshot.scenarioVersion !== previous.scenarioVersion || snapshot.chain?.course !== previous.chain?.course || snapshot.players.length !== previous.players.length || snapshot.chain?.endpoints.join(',') !== previous.chain?.endpoints.join(','))) return false;
    this.frames.push(snapshot);
    if (this.frames.length > this.capacity) this.frames.shift();
    this.receivedAt = now;
    this.clockOffset ??= snapshot.serverTimeMs - now;
    return true;
  }

  observeClock(serverTimeMs: number, sentAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (rtt < 0 || !Number.isFinite(rtt)) return;
    // Prefer low-RTT probes to limit queueing bias; periodically permit recalibration.
    if (rtt <= this.bestRtt * 1.2 || receivedAt - this.clockMeasuredAt > 10_000) {
      this.bestRtt = rtt;
      this.clockMeasuredAt = receivedAt;
      this.clockOffset = serverTimeMs - (sentAt + receivedAt) / 2;
    }
  }

  sample(now: number): PresentedSnapshot | undefined {
    const latest = this.latest;
    if (!latest || this.clockOffset === undefined) return;
    const target = Math.max(this.renderedAt ?? -Infinity, now + this.clockOffset - this.delayMs);
    this.renderedAt = Math.min(target, latest.serverTimeMs);
    let before = this.frames[0]!, after = before;
    for (const frame of this.frames) {
      if (frame.serverTimeMs <= target) before = frame;
      after = frame;
      if (frame.serverTimeMs >= target) break;
    }
    const alpha = after.serverTimeMs === before.serverTimeMs ? 0
      : Math.max(0, Math.min(1, (target - before.serverTimeMs) / (after.serverTimeMs - before.serverTimeMs)));
    const players = before.players.map((player) => {
      const next = after.players.find((other) => other.id === player.id)!;
      return { ...player, position: lerpPoint(player.position, next.position, alpha),
        velocity: lerpPoint(player.velocity, next.velocity, alpha), grounded: alpha < 0.5 ? player.grounded : next.grounded };
    });
    const chain: MotionChain | undefined = before.chain && after.chain ? { ...before.chain,
      segments: before.chain.segments.map((segment, index) => ({
        position: lerpPoint(segment.position, after.chain!.segments[index]!.position, alpha),
        rotation: slerp(segment.rotation, after.chain!.segments[index]!.rotation, alpha),
      })) } : undefined;
    const road = before.road && after.road ? { ...before.road,
      vehicles: before.road.vehicles.map((vehicle, index) => {
        const next = after.road!.vehicles[index]!;
        const delta = ((next.x - vehicle.x + 54) % 36) - 18;
        const x = ((vehicle.x + delta * alpha + 54) % 36) - 18;
        return { ...vehicle, x };
      }) } : undefined;
    // Same pass interpolates with player/cable alpha. Offscreen recycle is never
    // drawn sweeping across the crossing; signal changes at the earlier frame.
    const railway = before.railway && after.railway ? { ...before.railway,
      elapsedSeconds: before.railway.elapsedSeconds+(after.railway.elapsedSeconds-before.railway.elapsedSeconds)*alpha,
      x: before.railway.pass === after.railway.pass ? before.railway.x + (after.railway.x - before.railway.x) * alpha : before.railway.x,
    } : undefined;
    const running = before.phase==='running' && after.phase==='running';
    const river = before.river && after.river ? interpolateWater(before.river,after.river,alpha,running) : before.river;
    const world = before.world && after.world ? { ...before.world, water:interpolateWater(before.world.water,after.world.water,alpha,running), highWater:before.world.highWater+(after.world.highWater-before.world.highWater)*alpha, rearLimit:before.world.rearLimit+(after.world.rearLimit-before.world.rearLimit)*alpha, elapsedSeconds:before.world.elapsedSeconds+(after.world.elapsedSeconds-before.world.elapsedSeconds)*alpha, hazards: before.world.hazards.map(h=>{
      const next=after.world!.hazards.find(n=>n.id===h.id);
      if(h.road&&next?.road)return {...h,road:{...h.road,elapsedSeconds:h.road.elapsedSeconds+(next.road.elapsedSeconds-h.road.elapsedSeconds)*alpha,vehicles:h.road.vehicles.map((v,i)=>{
        const period=roadLanes(before.world!.sections.find(s=>s.id===h.id)!)[v.lane]!.period;
        const nx=next.road!.vehicles[i]!.x, delta=((nx-v.x+period*1.5)%period)-period/2;
        return {...v,x:((v.x+delta*alpha+period*1.5)%period)-period/2};
      })}};
      if(h.railway&&next?.railway)return {...h,railway:{...h.railway,elapsedSeconds:h.railway.elapsedSeconds+(next.railway.elapsedSeconds-h.railway.elapsedSeconds)*alpha,x:h.railway.pass===next.railway.pass?h.railway.x+(next.railway.x-h.railway.x)*alpha:h.railway.x}};
      return h;
    })} : undefined;
    // Terminal outcomes present the complete terminal assembly immediately; never mix
    // the new death state with pre-impact player/cable/vehicle transforms.
    if ((latest.world || latest.road || latest.river || latest.railway) && latest.phase === 'ended') return { players: latest.players, chain: latest.chain,
      world: latest.world, road: latest.road, river: latest.river, railway: latest.railway, snapshot: latest, ageMs: this.ageMs(now), holding: true };
    return { players, ...(world ? {world} : {}), ...(railway ? { railway } : {}), ...(river ? { river } : {}), ...(road ? { road } : {}), ...(chain ? { chain } : {}), snapshot: latest, ageMs: this.ageMs(now), holding: target > latest.serverTimeMs };
  }

  clear(): void {
    this.frames = [];
    this.renderedAt = this.clockOffset = undefined;
    this.receivedAt = this.clockMeasuredAt = 0;
    this.bestRtt = Infinity;
  }
}
