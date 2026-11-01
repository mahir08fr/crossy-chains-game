import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from './simulation';
import { runEndurance } from './endurance';

beforeAll(initializePhysics);
it('runs thirty simulated minutes of repeated pulling, contact, opposing inputs, release and scene rebuilds', () => {
  const report = runEndurance(1800);
  console.info('ENDURANCE_REPORT', JSON.stringify(report));
  expect(report.failures).toEqual([]);
  expect(report.simulatedSeconds).toBe(1800);
  expect(report.episodes).toBe(150);
  expect(report.maxExcess).toBeLessThan(0.05);
  expect(report.maxPenetration).toBeLessThan(0.03);
  expect(report.maxPlayerSpeed).toBeLessThan(8);
  expect(report.maxSegmentSpeed).toBeLessThan(20);
  expect(report.maxContacts).toBe(2);
  expect(report.bodyRange).toEqual([14, 14]);
  expect(report.colliderRange).toEqual([19, 21]);
  expect(report.jointRange).toEqual([13, 13]);
// This is a fixed-workload correctness gate, not a wall-clock performance budget.
// Keep all 108,000 ticks on contended development hosts.
}, 600_000);
