import { afterEach, beforeAll, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation';

beforeAll(initializePhysics);
const simulations: FoundationSimulation[] = [];
afterEach(() => { for (const simulation of simulations.splice(0)) simulation.dispose(); });
function create(id: string): FoundationSimulation {
  const scenario = scenarios.find((entry) => entry.id === id)!;
  const simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain);
  simulations.push(simulation);
  return simulation;
}

it.each(['slack', 'taut'])('creates a correctly anchored %s assembly, finite at rest with filtered contacts', (id) => {
  const simulation = create(id);
  expect(simulation.world.bodies.len()).toBe(14);
  expect(simulation.world.colliders.len()).toBe(19);
  expect(simulation.world.impulseJoints.len()).toBe(13);
  expect(simulation.chainMetrics()!.maxAnchorError).toBeLessThan(1e-5);
  const halfHeight = settings.chain.length / settings.chain.segments / 2 - settings.chain.radius;
  simulation.world.colliders.forEach((collider) => {
    if (collider.collisionGroups() === 0x00040001) {
      const axis = collider.rotation();
      // Rotated local Y projection; total capsule extent includes its round caps.
      const extentY = halfHeight * Math.abs(1 - 2 * (axis.x ** 2 + axis.z ** 2)) + settings.chain.radius;
      expect(collider.translation().y - extentY).toBeGreaterThan(0);
    }
  });
  for (let i = 0; i < 600; i++) simulation.step({});
  for (const segment of simulation.chainStates()) {
    expect(Object.values(segment.position).every(Number.isFinite)).toBe(true);
    expect(Object.values(segment.rotation).every(Number.isFinite)).toBe(true);
    expect(Math.hypot(segment.velocity.x, segment.velocity.y, segment.velocity.z)).toBeLessThan(0.5);
  }
  expect(simulation.chainMetrics()!.maxAnchorError).toBeLessThan(0.05);
  expect(simulation.states().every((state) => state.grounded)).toBe(true);
  simulation.world.impulseJoints.forEach((joint) => expect(joint.contactsEnabled()).toBe(false));
});

it('rebuilds all chain bodies and joints on reset without resource growth or old motion', () => {
  const simulation = create('slack');
  for (let cycle = 0; cycle < 20; cycle++) {
    for (let tick = 0; tick < 30; tick++) simulation.step({ p1: { x: 1, z: 0 } });
    simulation.reset();
    expect(simulation.world.bodies.len()).toBe(14);
    expect(simulation.world.colliders.len()).toBe(19);
    expect(simulation.world.impulseJoints.len()).toBe(13);
    expect(simulation.chainMetrics()!.maxAnchorError).toBeLessThan(1e-5);
    for (const segment of simulation.chainStates()) expect(segment.velocity).toEqual({ x: 0, y: 0, z: 0 });
    for (const state of simulation.states()) expect(state.tick).toBe(0);
  }
});


it('does not report cable or player bodies as valid ground when terrain is absent', () => {
  const scenario = scenarios.find(({ id }) => id === 'taut')!;
  const simulation = new FoundationSimulation(scenario.players, [], true);
  simulations.push(simulation);
  for (let tick = 0; tick < 3; tick++) simulation.step({});
  expect(simulation.states().every((state) => !state.grounded)).toBe(true);
  expect(simulation.state().velocity.y).toBeLessThan(0);
});
