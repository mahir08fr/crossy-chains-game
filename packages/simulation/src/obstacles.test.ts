import { afterEach, beforeAll, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation';
import type { PlayerInputs } from './simulation';

beforeAll(initializePhysics);
// Faster drive scales the old fixture budget; the absolute 20-m/s endurance
// ceiling and all penetration, contact, stretch and release gates stay intact.
const fixtureSpeedBudget = Math.min(20, 15 * settings.player.speed / 5);
const simulations: FoundationSimulation[] = [];
afterEach(() => { for (const simulation of simulations.splice(0)) simulation.dispose(); });
function create(id: string, withObstacles = true) {
  const scenario = scenarios.find((entry) => entry.id === id)!;
  const simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, withObstacles ? scenario.obstacles : []);
  simulations.push(simulation);
  for (let tick = 0; tick < 120; tick++) simulation.step({});
  return simulation;
}
function drive(simulation: FoundationSimulation, ticks: number, input: PlayerInputs) {
  let contactTicks = 0, maxExcess = 0, maxPenetration = 0, maxPairs = 0, maxObstacles = 0, maxSpeed = 0, maxPlayerHeight = 0;
  const stepTimes: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const started = performance.now();
    simulation.step(input);
    stepTimes.push(performance.now() - started);
    const contact = simulation.obstacleContacts();
    maxObstacles = Math.max(maxObstacles, contact.ids.length);
    for (const state of [...simulation.states(), ...simulation.chainStates()]) {
      expect(Object.values(state.position).every(Number.isFinite)).toBe(true);
      expect(Object.values(state.velocity).every(Number.isFinite)).toBe(true);
      maxSpeed = Math.max(maxSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
    }
    for (const state of simulation.states()) maxPlayerHeight = Math.max(maxPlayerHeight, state.position.y);
    if (contact.ids.length) contactTicks++;
    maxPairs = Math.max(maxPairs, contact.pairs);
    maxPenetration = Math.max(maxPenetration, contact.maxPenetration);
    maxExcess = Math.max(maxExcess, simulation.chainMetrics()!.excessRatio);
  }
  return { contactTicks, maxPairs, maxExcess, maxPenetration, maxObstacles, maxSpeed, maxPlayerHeight, p95StepMs: stepTimes.sort((a, b) => a - b)[Math.floor(ticks * 0.95)]!, states: simulation.states(), contact: simulation.obstacleContacts() };
}

it('catches a round post through physical contact and releases by reversing movement', () => {
  const simulation = create('post');
  expect(simulation.obstacleContacts().maxPenetration).toBe(0);
  const caught = drive(simulation, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  console.info('post caught', JSON.stringify(caught));
  expect(caught.contactTicks).toBeGreaterThan(60);
  expect(caught.maxPairs).toBeGreaterThan(1);
  expect(caught.maxExcess).toBeLessThan(0.1);
  expect(caught.maxSpeed).toBeLessThan(fixtureSpeedBudget);
  expect(caught.maxPenetration).toBeLessThan(0.03);
  const pulling = create('post');
  drive(pulling, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  const redirected = drive(pulling, 120, { p1: { x: 0, z: 1 } });
  console.info('post redirected', JSON.stringify(redirected));
  expect(redirected.contactTicks).toBeGreaterThan(30);
  expect(redirected.states[1]!.position.z).toBeLessThan(caught.states[1]!.position.z - 0.3);
  const released = drive(simulation, 240, { p1: { x: 0, z: -1 }, p2: { x: 0, z: -1 } });
  console.info('post released', JSON.stringify(released));
  expect(released.contact.ids).toEqual([]);
  expect(released.states.every(({ position }) => position.z < 1)).toBe(true);
  expect(simulation.world.impulseJoints.len()).toBe(13);
  // Removing only the obstacle changes motion; there is no scripted snag rule.
  const control = create('post', false);
  drive(control, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  expect(control.state().position.z).toBeGreaterThan(caught.states[0]!.position.z + 5);
}, 20_000);


it.each(['barrier', 'two-posts'])('holds and releases %s without tunneling, detachment or unstable opposing drive', (id) => {
  const simulation = create(id);
  expect(simulation.obstacleContacts().maxPenetration).toBe(0);
  const caught = drive(simulation, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  console.info(id, 'caught', JSON.stringify(caught));
  expect(caught.contactTicks).toBeGreaterThan(60);
  expect(caught.maxExcess).toBeLessThan(0.1);
  expect(caught.maxSpeed).toBeLessThan(fixtureSpeedBudget);
  expect(caught.maxPenetration).toBeLessThan(0.03);
  if (id === 'two-posts') expect(caught.maxObstacles).toBe(2);
  const opposed = drive(simulation, 3600, { p1: { x: 0.3, z: 1 }, p2: { x: -0.3, z: 1 } });
  console.info(id, 'opposed60', JSON.stringify(opposed));
  expect(opposed.contactTicks).toBeGreaterThan(3000);
  expect(opposed.maxExcess).toBeLessThan(0.05);
  expect(opposed.maxPenetration).toBeLessThan(0.03);
  expect(opposed.maxSpeed).toBeLessThan(fixtureSpeedBudget);
  expect(opposed.maxPlayerHeight).toBeLessThan(0.9);
  const released = drive(simulation, 240, { p1: { x: 0, z: -1 }, p2: { x: 0, z: -1 } });
  console.info(id, 'released', JSON.stringify(released));
  expect(released.contact.ids).toEqual([]);
  expect(released.states.every(({ position }) => position.z < 1)).toBe(true);
  expect(simulation.world.impulseJoints.len()).toBe(13);
  expect(caught.states.every(({ position }) => position.z < 7)).toBe(true);
  const control = create(id, false);
  drive(control, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  expect(control.state().position.z).toBeGreaterThan(caught.states[0]!.position.z + 5);
}, 20_000);

it.each(['post', 'barrier', 'two-posts'])('retains a physical %s cable catch even with player–obstacle solver forces disabled', (id) => {
  const simulation = create(id);
  const scenario = scenarios.find((entry) => entry.id === id)!;
  // Test-only solver masks separate character contact from cable contact.
  // Collision masks and terrain queries remain unchanged; normal game masks are not modified.
  simulation.world.colliders.forEach((collider) => {
    if (collider.parent()) {
      collider.setSolverGroups(collider.collisionGroups() === 0x00040001 ? 0x00040009 : 0x00020001);
    } else if (scenario.obstacles?.some(({ center }) => {
      const p = collider.translation();
      return Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) < 1e-5;
    })) collider.setSolverGroups(0x00080004);
  });
  const caught = drive(simulation, 240, { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
  expect(simulation.fault).toBeUndefined();
  expect(caught.contactTicks).toBeGreaterThan(60);
  expect(caught.states.every(({ position }) => position.z < 7)).toBe(true);
  const released = drive(simulation, 240, { p1: { x: 0, z: -1 }, p2: { x: 0, z: -1 } });
  expect(released.contact.ids).toEqual([]);
  expect(simulation.world.impulseJoints.len()).toBe(13);
}, 20_000);
