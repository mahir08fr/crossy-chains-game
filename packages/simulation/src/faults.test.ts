import { beforeAll, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { inspectBody, inspectConstraints } from './faults';
import { FoundationSimulation, initializePhysics } from './simulation';

beforeAll(initializePhysics);
it('detects invalid numerical poses/velocities and invalid constraint readings without feeding them to Rapier', () => {
  const safe = { position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, angularVelocity: { x: 0, y: 0, z: 0 } };
  expect(inspectBody(safe, 'player', settings.faults.playerSpeed)).toBeUndefined();
  expect(inspectBody({ ...safe, position: { ...safe.position, x: NaN } }, 'player', 15)?.kind).toBe('non-finite');
  expect(inspectBody({ ...safe, velocity: { ...safe.velocity, z: Infinity } }, 'player', 15)?.kind).toBe('non-finite');
  expect(inspectBody({ ...safe, angularVelocity: { ...safe.angularVelocity, y: 300 } }, 'segment', 35)?.kind).toBe('velocity');
  expect(inspectConstraints({ restLength: 6, endpointDistance: 4, effectivePathLength: Infinity, maxAnchorError: 0, totalAnchorError: 0, excessRatio: 0 })?.kind).toBe('non-finite');
});

it.each(['velocity', 'constraint'])('pauses a finite injected %s fault and rebuilds the entire group cleanly', (kind) => {
  const scenario = scenarios.find(({ id }) => id === 'two-posts')!;
  const simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, scenario.obstacles);
  try {
    for (let tick = 0; tick < 120; tick++) simulation.step({});
    const segment = simulation.world.getCollider([...simulation.world.colliders.getAll()].find((collider) => collider.collisionGroups() === 0x00040001)!.handle).parent()!;
    if (kind === 'velocity') segment.setLinvel({ x: 100, y: 0, z: 0 }, true);
    else segment.setTranslation({ x: 10, y: 3, z: 10 }, true);
    const tick = simulation.state().tick;
    simulation.step({ p1: { x: 1, z: 0 } });
    expect(simulation.fault?.kind).toBe(kind);
    expect(simulation.state().tick).toBe(tick);
    const frozen = simulation.states();
    for (let i = 0; i < 30; i++) simulation.step({ p1: { x: 1, z: 0 } });
    expect(simulation.states()).toEqual(frozen);
    simulation.reset();
    expect(simulation.fault).toBeUndefined();
    expect(simulation.world.bodies.len()).toBe(14);
    expect(simulation.world.colliders.len()).toBe(21);
    expect(simulation.world.impulseJoints.len()).toBe(13);
    expect(simulation.chainMetrics()!.maxAnchorError).toBeLessThan(1e-5);
    expect(simulation.obstacleContacts().ids).toEqual([]);
    for (const state of [...simulation.states(), ...simulation.chainStates()]) expect(state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 120; i++) simulation.step({});
    expect(simulation.fault).toBeUndefined();
    expect(simulation.state().tick).toBe(120);
  } finally { simulation.dispose(); }
});
