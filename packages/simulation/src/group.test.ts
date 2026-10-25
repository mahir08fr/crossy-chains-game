import { beforeAll, expect, it } from 'vitest';
import { groupScenario, roadScenario, scenarios } from '@crossy/config';
import type { GroupSize } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
beforeAll(initializePhysics);
for (const capacity of [2, 3, 4] as const) {
  it(`${capacity} players build adjacent physical chains and reset without growth`, () => {
    const s = groupScenario(roadScenario, capacity);
    const sim = new FoundationSimulation(s.players, s.boxes, true);
    try {
      for (let cycle = 0; cycle < 8; cycle++) {
        expect(sim.world.bodies.len()).toBe(capacity + 12 * (capacity - 1));
        expect(sim.world.impulseJoints.len()).toBe(13 * (capacity - 1));
        expect(sim.world.colliders.len()).toBe(s.boxes.length + capacity + 12 * (capacity - 1));
        expect(sim.chainMetricsAll()).toHaveLength(capacity - 1);
        for (let tick = 0; tick < 120; tick++) sim.step({});
        expect(sim.fault).toBeUndefined();
        expect(sim.chainMetricsAll().every(m => m.excessRatio < 0.05)).toBe(true);
        sim.reset();
        expect(sim.states().every(p => Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z) === 0)).toBe(true);
      }
    } finally { sim.dispose(); }
  }, 20_000);
}
for (const capacity of [3, 4] as GroupSize[]) {
  it(`${capacity} players transmit middle drive to both sides and sustain opposite tension`, () => {
    const s = groupScenario(scenarios.find(s => s.id === 'slack')!, capacity);
    const sim = new FoundationSimulation(s.players, s.boxes, true);
    try {
      for (let tick = 0; tick < 480; tick++) sim.step({ p2: { x: 0, z: 1 } });
      expect(sim.fault).toBeUndefined();
      expect(sim.state('p1').position.z).toBeGreaterThan(2);
      expect(sim.state(capacity === 3 ? 'p3' : 'p4').position.z).toBeGreaterThan(1);
      sim.reset();
      for (let tick = 0; tick < 3600; tick++) sim.step({ p1: { x: 1, z: 0 }, [capacity === 3 ? 'p3' : 'p4']: { x: -1, z: 0 } });
      expect(sim.fault).toBeUndefined();
      expect(sim.chainMetricsAll().every(m => m.excessRatio < 0.05 && m.endpointDistance < 6.3)).toBe(true);
    } finally { sim.dispose(); }
  }, 30_000);
}

import { RoadChallenge } from './road.js';
it('each of four traffic victims fails the group; success requires the final teammate', () => {
  const scenario = groupScenario(roadScenario, 4);
  for (const victim of scenario.players) {
    const road = new RoadChallenge();
    const poses = scenario.players.map(p => ({ id: p.id, position: p.id === victim.id ? { x: -14, y: 0.8, z: 3 } : p.spawn }));
    road.step(poses, poses, 1 / 240);
    expect(road.state()).toMatchObject({ outcome: 'failed', dead: [victim.id] });
    const terminal = road.state(); road.step(poses, poses, 1); expect(road.state()).toEqual(terminal);
  }
  const road = new RoadChallenge();
  const poses = scenario.players.map(p => ({ id: p.id, position: { x: p.spawn.x, y: 0.8, z: p.id === 'p4' ? 14 : 16 } }));
  road.step(poses, poses, 1 / 240); expect(road.state().outcome).toBe('active');
  poses[3]!.position.z = 16; road.step(poses, poses, 1 / 240); expect(road.state().outcome).toBe('cleared');
});
for (const capacity of [3, 4] as const) {
  it(`${capacity} players retain physical post/barrier contacts and reverse-release all chains`, () => {
    for (const id of ['post', 'barrier', 'two-posts']) {
      const base = groupScenario(scenarios.find(s => s.id === id)!, capacity);
      // Keep an obstacle between adjacent seats, clear of player capsules.
      const shift = capacity === 3 ? 2 : 0;
      const obstacles = base.obstacles!.map(o => ({ ...o, center: { ...o.center, x: o.center.x + shift } }));
      const sim = new FoundationSimulation(base.players, base.boxes, true, obstacles);
      let contact = false, excess = 0;
      try {
        for (let tick = 0; tick < 360; tick++) {
          sim.step(Object.fromEntries(base.players.map(p => [p.id, { x: 0, z: 1 }])));
          contact ||= sim.obstacleContacts().pairs > 0;
          excess = Math.max(excess, ...sim.chainMetricsAll().map(m => m.excessRatio));
        }
        expect(contact).toBe(true); expect(sim.fault).toBeUndefined(); expect(excess).toBeLessThan(0.05);
        for (let tick = 0; tick < 480; tick++) sim.step(Object.fromEntries(base.players.map(p => [p.id, { x: 0, z: -1 }])));
        expect(sim.fault).toBeUndefined(); expect(sim.obstacleContacts().ids).toEqual([]);
        expect(sim.world.impulseJoints.len()).toBe(13 * (capacity - 1));
      } finally { sim.dispose(); }
    }
  }, 25_000);
}
for (const capacity of [3, 4] as const) {
  it(`${capacity} players can gather physically and cross all three existing lanes together`, () => {
    const s = groupScenario(roadScenario, capacity), sim = new FoundationSimulation(s.players, s.boxes, true, [], true);
    try {
      // Test steering only: gather on the safe bank with bounded inputs; never move bodies directly.
      for (let tick = 0; tick < 240; tick++) sim.step(Object.fromEntries(sim.states().map((p, i) => [p.id,
        { x: Math.max(-1, Math.min(1, ((capacity - 1) * .45 - i * .9 - p.position.x) * .8)), z: 0 }])));
      // New colour-specific traffic has a safe launch at t=5 s. Settle after
      // physical gathering; retain the same crossing and geometry assertions.
      for (let tick = 0; tick < 60; tick++) sim.step({});
      const positions = sim.states();
      for (let i = 1; i < capacity; i++) expect(Math.hypot(positions[i]!.position.x - positions[i - 1]!.position.x, positions[i]!.position.z - positions[i - 1]!.position.z)).toBeGreaterThan(.65);
      for (let tick = 0; tick < 600 && sim.roadState()!.outcome === 'active'; tick++) sim.step(Object.fromEntries(s.players.map(p => [p.id, { x: 0, z: 1 }])));
      expect(sim.fault).toBeUndefined(); expect(sim.roadState()!.outcome).toBe('cleared');
      expect(sim.states().every(p => p.position.z >= 15.35)).toBe(true);
      console.info('M8 crossing', JSON.stringify({ capacity, elapsedSeconds: sim.roadState()!.elapsedSeconds, metrics: sim.chainMetricsAll() }));
      sim.reset(); expect(sim.roadState()!.elapsedSeconds).toBe(0); expect(sim.roadState()!.dead).toEqual([]);
    } finally { sim.dispose(); }
  }, 15_000);
}
