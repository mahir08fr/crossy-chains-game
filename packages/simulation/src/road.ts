import RAPIER from '@dimforge/rapier3d-compat';
import { wrapTrafficX, roadSettings, settings } from '@crossy/config';
import type { PlayerId, Point3 } from '@crossy/config';

export type RoadLane = { z: number; speed: number; direction: number; offset: number; period?: number; scale?: number; positions?: readonly number[] };
export type VehicleState = { id: number; lane: number; x: number };
export type RoadState = { elapsedSeconds: number; vehicles: VehicleState[]; dead: PlayerId[]; outcome: 'active' | 'failed' | 'cleared' };
const identity = { x: 0, y: 0, z: 0, w: 1 };
function canReachLane(from: Point3, to: Point3, carZ: number, scale = 1): boolean {
  const radius = settings.player.radius, extentY = settings.player.halfHeight + radius;
  const halfZ = roadSettings.carHalfSize.z * scale, halfY = roadSettings.carHalfSize.y * scale;
  return !(Math.min(from.z, to.z) > carZ + halfZ + radius || Math.max(from.z, to.z) < carZ - halfZ - radius
    || Math.min(from.y, to.y) > halfY * 2 + extentY || Math.max(from.y, to.y) < -extentY);
}
export function vehicleX(lane: number, index: number, time: number, lanes: readonly RoadLane[] = roadSettings.lanes, count = 2): number {
  const definition = lanes[lane]!;
  const period = definition.period ?? roadSettings.halfLength*2;
  const raw = definition.offset + definition.speed * definition.direction * time;
  if(definition.positions){
    const anchor=wrapTrafficX(raw,period);
    return index===0?anchor:wrapTrafficX(anchor+definition.positions[index]!,period);
  }
  return wrapTrafficX(raw+index*period/count,period);
}

/** Exact translational capsule/box sweep, independent of detailed car art.
 * Periodic images represent exit/re-entry; never sweep a teleport across the road. */
export function vehicleHitsPlayer(from: Point3, to: Point3, carX: number, carZ: number, displacement: number, scale = 1, period = roadSettings.halfLength*2): boolean {
  if (!canReachLane(from, to, carZ, scale)) return false;
  const half = {x:roadSettings.carHalfSize.x*scale,y:roadSettings.carHalfSize.y*scale,z:roadSettings.carHalfSize.z*scale};
  const box = new RAPIER.Cuboid(half.x, half.y, half.z);
  const capsule = new RAPIER.Capsule(settings.player.halfHeight, settings.player.radius);
  const velocity = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const margin = half.x + settings.player.radius;
  const low = Math.min(from.x, to.x) - Math.max(carX, carX + displacement) - margin;
  const high = Math.max(from.x, to.x) - Math.min(carX, carX + displacement) + margin;
  for (let image = Math.ceil(low / period); image <= Math.floor(high / period); image++) {
    const origin = { x: carX + image * period, y: half.y, z: carZ };
    if (box.intersectsShape(origin, identity, capsule, from, identity)) return true;
    const hit = box.castShape(origin, identity,
      { x: displacement, y: 0, z: 0 }, capsule, from, identity, velocity, 0, 1, true);
    if (hit) return true;
  }
  return false;
}

export class RoadChallenge {
  private readonly ids: number[];
  constructor(private readonly lanes: readonly RoadLane[] = roadSettings.lanes, private readonly count = 2, private readonly finishZ = roadSettings.finishZ as number, elapsedSeconds = 0) {
    this.time = elapsedSeconds;
    let next=0;this.ids=lanes.map(lane=>{const base=next;next+=lane.positions?.length??count;return base;});
  }
  private time = 0;
  private dead: PlayerId[] = [];
  private outcome: RoadState['outcome'] = 'active';
  get ended(): boolean { return this.outcome !== 'active'; }
  step(before: { id: PlayerId; position: Point3 }[], after: { id: PlayerId; position: Point3 }[], dt: number): void {
    if (this.ended || dt <= 0) return;
    const struck = new Set<PlayerId>();
    this.lanes.forEach((lane, laneIndex) => {
      // The Z/Y sweep is identical for every car in this lane. Reject it once
      // before calculating offscreen traffic positions; near-lane paths retain
      // the original exact periodic capsule/box sweep and sorted victims.
      const paths = before.map(player => ({ id: player.id, from: player.position, to: after.find(p => p.id === player.id)!.position }))
        .filter(path => canReachLane(path.from, path.to, lane.z, lane.scale));
      if (!paths.length) return;
      for (let index = 0; index < (lane.positions?.length ?? this.count); index++) {
        const x = vehicleX(laneIndex, index, this.time, this.lanes, this.count);
        for (const path of paths) {
          if (vehicleHitsPlayer(path.from, path.to, x, lane.z, lane.speed * lane.direction * dt, lane.scale, lane.period)) struck.add(path.id);
        }
      }
    });
    this.time += dt;
    this.dead = [...struck].sort();
    if (this.dead.length) this.outcome = 'failed';
    else if (after.every(player => player.position.z - settings.player.radius >= this.finishZ)) this.outcome = 'cleared';
  }
  state(): RoadState {
    return { elapsedSeconds: this.time, dead: [...this.dead], outcome: this.outcome,
      vehicles: this.lanes.flatMap((_, lane) => Array.from({ length: this.lanes[lane]!.positions?.length ?? this.count }, (_, index) => ({ id: this.ids[lane]! + index, lane, x: vehicleX(lane, index, this.time, this.lanes, this.count) }))) };
  }
}
