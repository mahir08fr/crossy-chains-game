import { beforeAll, describe, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { chainCourses, isSnapshotMessage } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';

beforeAll(initializePhysics);
describe('authoritative M2 assembly', () => {
  // Fixed simulation/reset work, not a real-time latency budget; allow a loaded test host.
  for (const course of chainCourses) it(`${course}: matches direct M2 physics and resets/faults as one assembly`, () => {
    const fixture = scenarios.find(({ id }) => id === course)!;
    const session = new AuthoritativeSession(course);
    const direct = new FoundationSimulation(fixture.players, fixture.boxes, true, fixture.obstacles);
    try {
      session.setPhase('running');
      for (let tick = 1; tick <= 240; tick++) {
        session.input('p1', 0, 1, tick); session.input('p2', 0, 1, tick);
        session.advance(settings.physics.tickSeconds); direct.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
        const snapshot = session.snapshot(tick);
        expect(snapshot.phase).toBe('running');
        expect(snapshot.chain!.segments).toEqual(direct.chainStates().map(({ position, rotation }) => ({ position, rotation })));
        expect(snapshot.players.map(({ acknowledgedSequence: _ack, ...player }) => player)).toEqual(direct.states().map(({ tick: _tick, ...player }) => player));
        expect(isSnapshotMessage(snapshot)).toBe(true);
      }
      const safe = session.snapshot(1000);
      // Snapshots own their data; consumers cannot mutate the retained fault fallback.
      session.snapshot(1001).chain!.segments[0]!.position.x = 1234;
      session.setPhase('paused'); session.advance(20);
      expect(session.snapshot(1002)).toMatchObject({ tick: safe.tick, players: safe.players, chain: safe.chain });
      session.simulation.world.bodies.forEach((body) => body.setLinvel({ x: 100, y: 0, z: 0 }, true));
      session.setPhase('running'); session.advance(settings.physics.tickSeconds);
      expect(session.snapshot(1003)).toMatchObject({ phase: 'fault', tick: safe.tick, players: safe.players, chain: safe.chain });
      for (let cycle = 1; cycle <= 10; cycle++) {
        session.reset();
        const reset = session.snapshot(1100 + cycle);
        expect(reset).toMatchObject({ phase: 'waiting', tick: 0, runGeneration: cycle });
        expect(reset.chain!.segments).toHaveLength(12);
        expect(session.simulation.world.bodies.len()).toBe(14);
        expect(session.simulation.world.impulseJoints.len()).toBe(13);
        expect(session.simulation.world.colliders.len()).toBe(19 + (fixture.obstacles?.length ?? 0));
        expect(session.simulation.obstacleContacts().ids).toHaveLength(0);
        expect(session.simulation.fault).toBeUndefined();
        expect(isSnapshotMessage(reset)).toBe(true);
      }
    } finally { session.dispose(); direct.dispose(); }
  }, 20_000);
});

function drive(session: AuthoritativeSession, ticks: number, p1 = { x: 0, z: 0 }, p2 = { x: 0, z: 0 }) {
  session.setPhase('running');
  let maxExcess = 0, maxContacts = 0, contactTicks = 0, penetration = 0;
  for (let tick = 0; tick < ticks; tick++) {
    session.input('p1', p1.x, p1.z, tick + 1); session.input('p2', p2.x, p2.z, tick + 1);
    session.advance(settings.physics.tickSeconds);
    expect(session.phase).toBe('running');
    const contacts = session.simulation.obstacleContacts();
    maxExcess = Math.max(maxExcess, session.simulation.chainMetrics()!.excessRatio);
    maxContacts = Math.max(maxContacts, contacts.ids.length);
    penetration = Math.max(penetration, contacts.maxPenetration);
    if (contacts.ids.length) contactTicks++;
  }
  expect(maxExcess).toBeLessThan(0.05);
  expect(penetration).toBeLessThan(0.03);
  return { maxExcess, maxContacts, contactTicks, penetration };
}
describe('server-owned physical feasibility', () => {
  it.each(['p1', 'p2'] as const)('%s physically drags the idle peer', (slot) => {
    const session = new AuthoritativeSession('slack');
    try {
      drive(session, 120);
      const index = slot === 'p1' ? 1 : 0, direction = slot === 'p1' ? 1 : -1;
      const start = session.snapshot(0).players[index]!.position.x;
      drive(session, 360, slot === 'p1' ? { x: direction, z: 0 } : undefined, slot === 'p2' ? { x: direction, z: 0 } : undefined);
      expect((session.snapshot(1).players[index]!.position.x - start) * direction).toBeGreaterThan(5);
    } finally { session.dispose(); }
  });
  it('limits separation and remains stable through sixty seconds of opposing forces', () => {
    const session = new AuthoritativeSession('taut');
    try {
      drive(session, 120); drive(session, 3600, { x: 1, z: 0 }, { x: -1, z: 0 });
      const metrics = session.simulation.chainMetrics()!;
      expect(metrics.endpointDistance).toBeGreaterThan(5.7);
      expect(metrics.endpointDistance).toBeLessThan(6.3);
      expect(session.snapshot(0).players.every(({ velocity }) => Math.hypot(velocity.x, velocity.z) < .1)).toBe(true);
    } finally { session.dispose(); }
  }, 15_000);
  it.each(['post', 'barrier', 'two-posts'] as const)('%s catches, supports tension and reverse releases without reset', (course) => {
    const session = new AuthoritativeSession(course);
    try {
      drive(session, 120);
      const catchResult = drive(session, 240, { x: 0, z: 1 }, { x: 0, z: 1 });
      expect(catchResult.contactTicks).toBeGreaterThan(60);
      if (course === 'two-posts') expect(catchResult.maxContacts).toBe(2);
      const caught = session.snapshot(0);
      if (course === 'post') {
        drive(session, 120, { x: 0, z: 1 });
        expect(session.snapshot(1).players[1]!.position.z).toBeLessThan(caught.players[1]!.position.z - .3);
      } else {
        expect(drive(session, 3600, { x: .3, z: 1 }, { x: -.3, z: 1 }).contactTicks).toBeGreaterThan(3000);
      }
      drive(session, 240, { x: 0, z: -1 }, { x: 0, z: -1 });
      expect(session.simulation.obstacleContacts().ids).toEqual([]);
      expect(session.snapshot(2).players.every(({ position }) => position.z < 1)).toBe(true);
      expect(session.runGeneration).toBe(0); expect(session.simulation.world.impulseJoints.len()).toBe(13);
      console.info('[M5 authoritative contact]', JSON.stringify({ course, ...catchResult }));
    } finally { session.dispose(); }
  }, 20_000);
});
