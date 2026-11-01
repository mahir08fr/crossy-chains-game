import { beforeAll, expect, it } from 'vitest';
import { groupScenario, roadScenario } from '@crossy/config';
import { initializePhysics, FoundationSimulation } from '@crossy/simulation';
import { isSnapshotMessage, maxSnapshotBytes, playerSlots } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';
beforeAll(initializePhysics);
for (const capacity of [3, 4] as const) {
  it(`${capacity} authoritative road players share topology, traffic, death, fault and complete reset`, () => {
    const session = new AuthoritativeSession('road', capacity), scenario = groupScenario(roadScenario, capacity);
    const direct = new FoundationSimulation(scenario.players, scenario.boxes, true, [], true);
    try {
      session.setPhase('running');
      for (let tick = 0; tick < 120; tick++) {
        direct.step({}); session.advance(1 / 60);
        expect(session.snapshot(tick).players.map(p => p.position)).toEqual(direct.states().map(p => p.position));
      }
      const snap = session.snapshot(1000);
      expect(isSnapshotMessage(snap)).toBe(true); expect(JSON.stringify(snap).length).toBeLessThan(maxSnapshotBytes);
      expect(snap.chain!.endpoints).toEqual(playerSlots.slice(0, capacity));
      expect(snap.chain!.segments).toHaveLength(12 * (capacity - 1));
      const bad = structuredClone(snap); bad.chain!.endpoints.reverse(); expect(isSnapshotMessage(bad)).toBe(false);
      bad.chain = structuredClone(snap.chain!); bad.chain.segments.pop(); expect(isSnapshotMessage(bad)).toBe(false);
      expect(isSnapshotMessage({ ...snap, players: snap.players.slice(1) })).toBe(false);
      const last = playerSlots[capacity - 1]!;
      const body = session.simulation.world.bodies.getAll()[capacity - 1]!;
      // Fault injection is test-only; production drive never writes poses/velocities.
      body.setLinvel({ x: 100, y: 0, z: 0 }, true); session.advance(1 / 60);
      expect(session.phase).toBe('fault'); expect(session.snapshot(1001).players).toEqual(snap.players);
      expect(session.simulation.fault!.detail).toBeDefined();
      session.reset(); expect(session.runGeneration).toBe(1);
      expect(session.snapshot(1002).road!.outcome).toBe('active');
      expect(session.snapshot(1002).players.find(p => p.id === last)!.acknowledgedSequence).toBe(0);
      expect(session.simulation.world.bodies.len()).toBe(capacity + 12 * (capacity - 1));
      const safe = session.snapshot(1003);
      const finalSegment = session.simulation.world.bodies.getAll().at(-1)!;
      const point = finalSegment.translation(); finalSegment.setTranslation({ ...point, x: point.x + 2 }, true);
      session.setPhase('running'); session.advance(1/60); expect(session.phase).toBe('fault');
      expect(session.snapshot(1004).chain).toEqual(safe.chain); // Includes the last connection, not only p1–p2.
      session.reset(); expect(session.simulation.fault).toBeUndefined();

    } finally { session.dispose(); direct.dispose(); }
  }, 15_000);
}
