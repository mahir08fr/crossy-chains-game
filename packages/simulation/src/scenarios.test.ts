import { beforeAll, expect, it } from 'vitest';
import { scenarios } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation';

beforeAll(initializePhysics);
it('rebuilds each authored scenario without retained motion or resource growth', () => {
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const scenario of scenarios) {
      const simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, scenario.obstacles);
      try {
        for (let i = 0; i < 45; i++) simulation.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: -1 } });
        simulation.reset();
        expect(simulation.world.bodies.len()).toBe(2 + (scenario.chain ? 12 : 0));
        expect(simulation.world.colliders.len()).toBe(scenario.boxes.length + (scenario.obstacles?.length ?? 0) + 2 + (scenario.chain ? 12 : 0));
        expect(simulation.world.impulseJoints.len()).toBe(scenario.chain ? 13 : 0);
        expect(simulation.obstacleContacts().maxPenetration).toBe(0);
        for (const { id, spawn } of scenario.players) {
          const state = simulation.state(id);
          expect(state.tick).toBe(0);
          expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
          for (const axis of ['x', 'y', 'z'] as const) expect(state.position[axis]).toBeCloseTo(spawn[axis], 6);
        }
        for (let i = 0; i < 120; i++) simulation.step({});
        for (const { id, spawn } of scenario.players) {
          if (scenario.chain) {
            // Resting sag physically draws endpoints slightly inward; explicit reset above stays exact.
            expect(Math.abs(simulation.state(id).position.x - spawn.x)).toBeLessThan(0.5);
            expect(Math.abs(simulation.state(id).position.z - spawn.z)).toBeLessThan(0.05);
          } else {
            expect(simulation.state(id).position.x).toBeCloseTo(spawn.x, 4);
            expect(simulation.state(id).position.z).toBeCloseTo(spawn.z, 4);
          }
          expect(simulation.state(id).grounded).toBe(true);
        }
      } finally { simulation.dispose(); }
    }
  }
// This checks 120 complete fixture rebuilds, not a wall-clock performance budget.
}, 60_000);
