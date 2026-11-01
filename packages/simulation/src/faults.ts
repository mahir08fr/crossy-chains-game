import { settings } from '@crossy/config';
import type { Point3 } from '@crossy/config';
import type { ChainMetrics, Rotation4 } from './chain.js';

export type FaultReason = { kind: 'non-finite' | 'velocity' | 'constraint'; detail: string };
export type SimulationFault = FaultReason & { tick: number };
export type BodySample = { position: Point3; rotation: Rotation4; velocity: Point3; angularVelocity: Point3 };

export function inspectBody(sample: BodySample, label: string, speedLimit: number): FaultReason | undefined {
  const { position: p, rotation: q, velocity: v, angularVelocity: w } = sample;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
    || !Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)
    || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)
    || !Number.isFinite(w.x) || !Number.isFinite(w.y) || !Number.isFinite(w.z)) {
    return { kind: 'non-finite', detail: `${label}: non-finite pose or velocity` };
  }
  const speed = Math.hypot(sample.velocity.x, sample.velocity.y, sample.velocity.z);
  const spin = Math.hypot(sample.angularVelocity.x, sample.angularVelocity.y, sample.angularVelocity.z);
  if (speed > speedLimit || spin > settings.faults.angularSpeed) {
    return { kind: 'velocity', detail: `${label}: speed ${speed.toFixed(2)} m/s, spin ${spin.toFixed(2)} rad/s` };
  }
}

export function inspectConstraints(metrics: ChainMetrics | undefined): FaultReason | undefined {
  if (!metrics) return;
  if (!Object.values(metrics).every(Number.isFinite)) return { kind: 'non-finite', detail: 'Non-finite chain metric' };
  if (metrics.maxAnchorError > settings.faults.anchorGap || metrics.excessRatio > settings.faults.pathExcess) {
    return { kind: 'constraint', detail: `Chain gap ${metrics.maxAnchorError.toFixed(3)} m, path excess ${(metrics.excessRatio * 100).toFixed(1)}%` };
  }
}
