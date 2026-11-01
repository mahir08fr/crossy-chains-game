import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { localPlayers, settings } from '@crossy/config';
import { FixedStepClock } from './fixed-step';
import { FoundationSimulation, initializePhysics, normalizeInput } from './simulation';
import type { MovementInput } from './simulation';

beforeAll(initializePhysics);
const simulations: FoundationSimulation[] = [];
afterEach(() => {
  for (const simulation of simulations.splice(0)) simulation.dispose();
});

function create(): FoundationSimulation {
  const simulation = new FoundationSimulation();
  simulations.push(simulation);
  run(simulation, 60);
  return simulation;
}

function run(simulation: FoundationSimulation, ticks: number, input: MovementInput = { x: 0, z: 0 }): void {
  for (let i = 0; i < ticks; i++) simulation.step({ p1: input });
}

describe('dynamic player foundation', () => {
  it('settles on the floor and stays upright at rest', () => {
    const simulation = create();
    run(simulation, 600);
    const state = simulation.state();
    expect(state.position.y).toBeCloseTo(settings.player.radius + settings.player.halfHeight, 1);
    expect(state.position.x).toBeCloseTo(0, 4);
    expect(state.position.z).toBeCloseTo(settings.player.spawn.z, 4);
    expect(state.grounded).toBe(true);
  });

  it('does not give diagonal movement a speed advantage', () => {
    const straight = create();
    const diagonal = create();
    run(straight, 45, { x: 1, z: 0 });
    run(diagonal, 45, { x: 1, z: 1 });
    const speed = (simulation: FoundationSimulation) => {
      const { velocity } = simulation.state();
      return Math.hypot(velocity.x, velocity.z);
    };
    expect(speed(diagonal)).toBeCloseTo(speed(straight), 2);
    expect(speed(straight)).toBeGreaterThan(4);
  });

  it('brakes after input is released', () => {
    const simulation = create();
    run(simulation, 60, { x: 1, z: 0 });
    const before = simulation.state().position.x;
    run(simulation, 60);
    const state = simulation.state();
    expect(Math.abs(state.velocity.x)).toBeLessThan(0.02);
    expect(state.position.x - before).toBeLessThan(0.7);
  });

  it('cannot pass through the barrier under sustained input', () => {
    const simulation = create();
    run(simulation, 1800, { x: 0, z: 1 });
    const { position, velocity } = simulation.state();
    expect(position.z).toBeGreaterThan(0.8);
    expect(position.z).toBeLessThan(1.05);
    expect(position.y).toBeLessThan(0.85);
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeLessThan(0.1);
  });

  it('slides along a barrier and can move around its end', () => {
    const simulation = create();
    run(simulation, 150, { x: 0, z: 1 });
    run(simulation, 90, { x: 1, z: 1 });
    run(simulation, 100, { x: 0, z: 1 });
    expect(simulation.state().position.z).toBeGreaterThan(4);
  });

  it('remains inside the test course boundary', () => {
    const simulation = create();
    run(simulation, 1800, { x: 1, z: 0 });
    expect(simulation.state().position.x).toBeLessThan(11.4);
    expect(simulation.state().position.x).toBeGreaterThan(11.2);
  });

  it('resets position, velocity, forces and tick without adding bodies', () => {
    const simulation = create();
    run(simulation, 90, { x: 1, z: 0 });
    const bodies = simulation.world.bodies.len();
    for (let i = 0; i < 20; i++) {
      simulation.reset();
      // Rapier stores transforms as float32; compare within physical precision.
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(simulation.state().position[axis]).toBeCloseTo(settings.player.spawn[axis], 6);
      }
      expect(simulation.state().velocity).toEqual({ x: 0, y: 0, z: 0 });
      expect(simulation.state().tick).toBe(0);
      run(simulation, 60);
    }
    expect(simulation.world.bodies.len()).toBe(bodies);
    expect(simulation.state().position.x).toBeCloseTo(0, 4);
  });

  it('produces equal movement across 30, 60 and 144 Hz rendering', () => {
    const positions = [30, 60, 144].map((fps) => {
      const simulation = create();
      const clock = new FixedStepClock(settings.physics.tickSeconds, settings.physics.maxCatchUpTicks);
      for (let frame = 0; frame < fps; frame++) {
        clock.advance(1 / fps, () => simulation.step({ p1: { x: 1, z: 0 } }));
      }
      return simulation.state().position.x;
    });
    expect(positions[0]).toBeCloseTo(positions[1]!, 5);
    expect(positions[1]).toBeCloseTo(positions[2]!, 5);
  });

  it('rejects invalid input and bounds analog magnitude', () => {
    expect(normalizeInput({ x: Infinity, z: 1 })).toEqual({ x: 0, z: 0 });
    expect(Math.hypot(...Object.values(normalizeInput({ x: 10, z: 10 })))).toBeCloseTo(1);
    expect(normalizeInput({ x: 0.3, z: 0.4 })).toEqual({ x: 0.3, z: 0.4 });
  });
});

describe('fixed timestep', () => {
  it('bounds catch-up after a suspension and resets interpolation', () => {
    const clock = new FixedStepClock(1 / 60, 6);
    let ticks = 0;
    clock.advance(10, () => ticks++);
    expect(ticks).toBe(6);
    expect(clock.droppedSeconds).toBeCloseTo(9.9);
    expect(clock.alpha).toBeLessThan(1);
    clock.reset();
    expect(clock.alpha).toBe(0);
    expect(clock.droppedSeconds).toBe(0);
  });
});


describe('two independent players', () => {
  function createPair(): FoundationSimulation {
    const simulation = new FoundationSimulation(localPlayers);
    simulations.push(simulation);
    for (let i = 0; i < 60; i++) simulation.step({});
    return simulation;
  }

  it.each(['p1', 'p2'] as const)('routes %s input without driving the other player', (id) => {
    const simulation = createPair();
    const other = id === 'p1' ? 'p2' : 'p1';
    const before = simulation.state(other).position;
    for (let i = 0; i < 45; i++) simulation.step({ [id]: { x: 0, z: 1 } });
    expect(simulation.state(id).position.z).toBeGreaterThan(-3);
    expect(simulation.state(other).position.x).toBeCloseTo(before.x, 4);
    expect(simulation.state(other).position.z).toBeCloseTo(before.z, 4);
    expect(simulation.states().map((state) => state.id)).toEqual(['p1', 'p2']);
  });

  it('normalizes each diagonal independently during simultaneous movement', () => {
    const straight = createPair();
    const diagonal = createPair();
    for (let i = 0; i < 45; i++) {
      straight.step({ p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } });
      diagonal.step({ p1: { x: 1, z: 1 }, p2: { x: -1, z: 1 } });
    }
    for (const { id } of localPlayers) {
      const a = straight.state(id).velocity;
      const b = diagonal.state(id).velocity;
      expect(Math.hypot(b.x, b.z)).toBeCloseTo(Math.hypot(a.x, a.z), 2);
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(4);
    }
  });

  it('preserves barrier collisions and resets both players without resource growth', () => {
    const simulation = createPair();
    for (let cycle = 0; cycle < 20; cycle++) {
      for (let i = 0; i < 150; i++) simulation.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
      for (const state of simulation.states()) {
        expect(state.position.z).toBeGreaterThan(0.8);
        expect(state.position.z).toBeLessThan(1.05);
      }
      simulation.reset();
      for (const { id, spawn } of localPlayers) {
        const state = simulation.state(id);
        for (const axis of ['x', 'y', 'z'] as const) expect(state.position[axis]).toBeCloseTo(spawn[axis], 6);
        expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
        expect(state.tick).toBe(0);
        expect(state.grounded).toBe(false);
      }
      expect(simulation.world.bodies.len()).toBe(2);
      expect(simulation.world.colliders.len()).toBe(11);
    }
    for (let i = 0; i < 60; i++) simulation.step({});
    for (const { id, spawn } of localPlayers) expect(simulation.state(id).position.z).toBeCloseTo(spawn.z, 4);
  });
});
