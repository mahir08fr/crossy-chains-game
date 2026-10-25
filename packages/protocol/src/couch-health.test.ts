import { expect, it } from 'vitest';
import { isControllerDiagnostic, isCouchHealth } from './index';
import type { CouchHealth } from './index';
const report = { protocolVersion: 1, connectionGeneration: 1, event: 'input-gate', detail: { reason: 'status-stale', arrivalAgeMs: 3, alignedAgeMs: 502 } };
it('bounds diagnostic reports and rejects unapproved fields, spoofed slots and nonfinite timing', () => {
  expect(isControllerDiagnostic(report)).toBe(true);
  for (const extra of [{ slot: 'p2' }, { connectionGeneration: -1 }, { event: 'arbitrary' }, { detail: { token: 'secret' } }, { detail: { gapMs: Infinity } }, { detail: { reason: 'x'.repeat(65) } }])
    expect(isControllerDiagnostic({ ...report, ...extra })).toBe(false);
});
it('validates bounded health including expired owner and last input rejection', () => {
  const health: CouchHealth = { protocolVersion: 1, serverTimeMs: 500, runGeneration: 1, phase: 'paused', boundary: 'input-expired:p1',
    blockers: [{ device: 'p1', reason: 'input-expired' }], display: { connected: true, active: true, heartbeatAgeMs: 20 },
    streams: [{ slot: 'p1', generation: 1, sequence: 40, requiresNeutral: true, neutralReason: 'expired', silenceMs: 250, lastRejection: 'stale-input' }], reports: [] };
  expect(isCouchHealth(health)).toBe(true);
  expect(isCouchHealth({ ...health, blockers: [{ device: 'p5', reason: 'input-expired' }] })).toBe(false);
  expect(isCouchHealth({ ...health, reports: Array(9).fill({}) })).toBe(false);
  expect(isCouchHealth({ ...health, token: 'secret' })).toBe(false);
});
