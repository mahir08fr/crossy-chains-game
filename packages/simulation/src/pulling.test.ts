import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { FixedStepClock } from './fixed-step';
import { FoundationSimulation, initializePhysics } from './simulation';
import type { PlayerInputs } from './simulation';

beforeAll(initializePhysics);
// Scale the old 5-m/s fixture budgets with the authorized faster drive, while
// retaining the unchanged absolute endurance ceilings (8 player / 20 cable).
const driveScale = settings.player.speed / 5;
const fixtureSpeedBudget = Math.min(20, 12 * driveScale);
const fixturePlayerBudget = Math.min(8, 6 * driveScale);
const simulations: FoundationSimulation[] = [];
afterEach(() => { for (const simulation of simulations.splice(0)) simulation.dispose(); });
function create(id = 'slack'): FoundationSimulation {
  const scenario = scenarios.find((entry) => entry.id === id)!;
  const simulation = new FoundationSimulation(scenario.players, scenario.boxes, true);
  simulations.push(simulation);
  for (let tick = 0; tick < 120; tick++) simulation.step({});
  return simulation;
}
function measure(simulation: FoundationSimulation, ticks: number, inputs: PlayerInputs) {
  let maxExcess = 0, sustainedExcess = 0, maxSpeed = 0, maxPlayerSpeed = 0, maxGap = 0, maxEndpointExcess = 0;
  for (let tick = 0; tick < ticks; tick++) {
    simulation.step(inputs);
    const metrics = simulation.chainMetrics()!;
    maxExcess = Math.max(maxExcess, metrics.excessRatio);
    if (tick > 60) sustainedExcess = Math.max(sustainedExcess, metrics.excessRatio);
    maxEndpointExcess = Math.max(maxEndpointExcess, metrics.endpointDistance / metrics.restLength - 1);
    for (const state of simulation.states()) {
      maxPlayerSpeed = Math.max(maxPlayerSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
      expect(state.position.y).toBeLessThan(0.9);
    }
    maxGap = Math.max(maxGap, metrics.maxAnchorError);
    for (const state of [...simulation.states(), ...simulation.chainStates()]) {
      expect(Object.values(state.position).every(Number.isFinite)).toBe(true);
      expect(Object.values(state.velocity).every(Number.isFinite)).toBe(true);
      maxSpeed = Math.max(maxSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
    }
  }
  return { maxExcess, sustainedExcess, maxSpeed, maxPlayerSpeed, maxGap, maxEndpointExcess, final: simulation.chainMetrics()! };
}

describe('open-ground physical pulling', () => {
  it.each(['p1', 'p2'] as const)('lets %s drag its neutral teammate without a distance clamp', (id) => {
    const simulation = create();
    const other = id === 'p1' ? 'p2' : 'p1';
    const direction = id === 'p1' ? 1 : -1;
    const before = simulation.state(other).position.x;
    const result = measure(simulation, 360, { [id]: { x: direction, z: 0 } });
    console.info('drag', id, JSON.stringify({ ...result, teammateTravel: (simulation.state(other).position.x - before) * direction, playerSpeed: Math.abs(simulation.state(id).velocity.x) }));
    expect((simulation.state(other).position.x - before) * direction).toBeGreaterThan(5);
    expect(result.maxExcess).toBeLessThan(0.1);
    expect(result.sustainedExcess).toBeLessThan(0.05);
    expect(result.maxSpeed).toBeLessThan(fixtureSpeedBudget);
    expect(result.maxPlayerSpeed).toBeLessThan(fixturePlayerBudget);
    expect(result.maxEndpointExcess).toBeLessThan(0.1);
  });

  it.each([0.25, 0.5, 1])('limits separation under approach input magnitude %s', (magnitude) => {
    const simulation = create();
    const result = measure(simulation, 600, { p1: { x: magnitude, z: 0 }, p2: { x: -magnitude, z: 0 } });
    console.info('approach', magnitude, JSON.stringify(result));
    expect(result.final.endpointDistance).toBeGreaterThan(settings.chain.length * 0.95);
    expect(result.final.endpointDistance).toBeLessThan(settings.chain.length * 1.05);
    expect(result.maxExcess).toBeLessThan(0.1);
    expect(result.sustainedExcess).toBeLessThan(0.05);
    expect(result.maxSpeed).toBeLessThan(fixtureSpeedBudget);
    expect(result.maxPlayerSpeed).toBeLessThan(fixturePlayerBudget);
    expect(result.maxEndpointExcess).toBeLessThan(0.1);
  });

  it('remains finite and settles during sixty seconds of opposing pulls', () => {
    const simulation = create('taut');
    const result = measure(simulation, 3600, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } });
    console.info('opposing60', JSON.stringify(result));
    expect(result.maxExcess).toBeLessThan(0.1);
    expect(result.sustainedExcess).toBeLessThan(0.05);
    expect(result.maxSpeed).toBeLessThan(fixtureSpeedBudget);
    expect(result.maxPlayerSpeed).toBeLessThan(fixturePlayerBudget);
    expect(result.maxEndpointExcess).toBeLessThan(0.1);
    for (const state of simulation.states()) {
      expect(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)).toBeLessThan(0.1);
      expect(state.position.y).toBeLessThan(0.85);
    }
    // Allow loaded desktops to finish all 3,600 ticks; physical limits above stay unchanged.
  }, 15_000);

  it('keeps slack physically folded without pulling a teammate across the free length', () => {
    const simulation = create();
    const before = simulation.state('p2').position;
    // Small analog motion remains comfortably inside available slack.
    const result = measure(simulation, 60, { p1: { x: 0.1, z: 0 } });
    expect(result.final.endpointDistance).toBeLessThan(5);
    expect(Math.abs(simulation.state('p2').position.x - before.x)).toBeLessThan(0.15);
    expect(result.final.endpointDistance).toBeLessThan(result.final.restLength - 1);
  });

  it('folds under gentle inward movement rather than behaving as a rigid spacer', () => {
    const simulation = create();
    const result = measure(simulation, 60, { p1: { x: -0.25, z: 0 }, p2: { x: 0.25, z: 0 } });
    expect(result.final.endpointDistance).toBeLessThan(3);
    expect(result.maxExcess).toBeLessThan(0.1);
  });

  it.each([Math.PI / 2, Math.PI / 4])('limits separation after rotating the fixture by %s radians', (angle) => {
    const scenario = scenarios.find(({ id }) => id === 'slack')!;
    const players = scenario.players.map((player) => ({ ...player, spawn: {
      x: player.spawn.x * Math.cos(angle), y: player.spawn.y, z: player.spawn.x * Math.sin(angle),
    } }));
    const simulation = new FoundationSimulation(players, scenario.boxes, true);
    simulations.push(simulation);
    for (let tick = 0; tick < 120; tick++) simulation.step({});
    const result = measure(simulation, 600, {
      p1: { x: Math.cos(angle), z: Math.sin(angle) },
      p2: { x: -Math.cos(angle), z: -Math.sin(angle) },
    });
    expect(result.maxExcess).toBeLessThan(0.1);
    expect(result.sustainedExcess).toBeLessThan(0.05);
    expect(result.maxEndpointExcess).toBeLessThan(0.1);
    expect(result.maxPlayerSpeed).toBeLessThan(fixturePlayerBudget);
    expect(result.final.endpointDistance).toBeLessThan(settings.chain.length * 1.05);
  });

  it('brakes the connected group after release without erasing external velocity', () => {
    const simulation = create();
    for (let tick = 0; tick < 240; tick++) simulation.step({ p1: { x: 1, z: 0 } });
    expect(simulation.state('p2').velocity.x).toBeGreaterThan(1);
    const before = simulation.state('p1').position.x;
    const result = measure(simulation, 180, {});
    expect(simulation.state('p1').position.x - before).toBeGreaterThan(0.1);
    expect(simulation.state('p1').position.x - before).toBeLessThan(1.5);
    for (const state of simulation.states()) expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeLessThan(0.05);
    expect(result.maxExcess).toBeLessThan(0.1);
  });

  it('gives the same connected motion at 30, 60 and 144 Hz render sampling', () => {
    const outcomes = [30, 60, 144].map((fps) => {
      const simulation = create();
      const clock = new FixedStepClock(settings.physics.tickSeconds, settings.physics.maxCatchUpTicks);
      for (let frame = 0; frame < fps * 4; frame++) clock.advance(1 / fps, () => simulation.step({ p1: { x: 1, z: 0 } }));
      return { players: simulation.states(), chain: simulation.chainStates(), metrics: simulation.chainMetrics()! };
    });
    for (const outcome of outcomes.slice(1)) {
      expect(outcome).toEqual(outcomes[0]);
    }
  });
});
