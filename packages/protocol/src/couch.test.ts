import { expect, it } from 'vitest';
import { isCouchOptions, isControllerStatus, isDisplayWelcome, isDisplayHeartbeat } from './index';
it('strictly separates couch roles, bounds capacity and rejects extra authority claims', () => {
  expect(isCouchOptions({ protocolVersion: 1, role: 'display', displaySecret: 'a'.repeat(32), capacity: 4 })).toBe(true);
  expect(isCouchOptions({ protocolVersion: 1, role: 'controller' })).toBe(true);
  for (const options of [{ role: 'controller', capacity: 3 }, { role: 'display', displaySecret: 'a'.repeat(32), capacity: 5 }, { role: 'display', slot: 'p1' }, { role: 'desktop' }]) expect(isCouchOptions({ protocolVersion: 1, ...options })).toBe(false);
  expect(isDisplayWelcome({ protocolVersion: 1, role: 'display', connectionGeneration: 1, runGeneration: 0, serverTimeMs: 2 })).toBe(true);
  expect(isDisplayHeartbeat({ protocolVersion: 1, active: true, slot: 'p1' })).toBe(false);
  const status = { protocolVersion: 1, runGeneration: 1, serverTimeMs: 2, phase: 'ended', outcome: 'cleared', displayActive: true };
  expect(isControllerStatus(status)).toBe(true); expect(isControllerStatus({ ...status, phase: 'running' })).toBe(false);
  expect(isControllerStatus({ ...status, players: [] })).toBe(false);
});
