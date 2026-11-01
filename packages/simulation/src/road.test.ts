import { beforeAll, expect, it } from 'vitest';
import { roadScenario, roadSettings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
import { RoadChallenge, vehicleHitsPlayer } from './road.js';
beforeAll(initializePhysics);
const p = (x = 0, z = 3, y = 0.77) => ({ x, y, z });
it('sweeps fast vehicles in both directions, both moving shapes and initial penetration', () => {
  expect(vehicleHitsPlayer(p(), p(), -10, 3, 20)).toBe(true);
  expect(vehicleHitsPlayer(p(), p(), 10, 3, -20)).toBe(true);
  expect(vehicleHitsPlayer(p(-8), p(8), 0, 3, 0)).toBe(true);
  expect(vehicleHitsPlayer(p(), p(), 0, 3, 0)).toBe(true);
  expect(vehicleHitsPlayer(p(), p(), -10, 3, 1)).toBe(false);
});
it('rejects vertical/lane near misses and rounded capsule corner misses', () => {
  expect(vehicleHitsPlayer(p(0, 4.22), p(0, 4.22), -10, 3, 20)).toBe(false);
  expect(vehicleHitsPlayer(p(0, 3, 3), p(0, 3, 3), -10, 3, 20)).toBe(false);
  expect(vehicleHitsPlayer(p(2.1, 4.19), p(2.1, 4.19), 0, 3, 0)).toBe(false);
});
it('checks offscreen wraps without a false centre-road sweep, including multiple periods', () => {
  expect(vehicleHitsPlayer(p(), p(), 17.9, 3, 0.4)).toBe(false);
  expect(vehicleHitsPlayer(p(), p(), -17.9, 3, -0.4)).toBe(false);
  expect(vehicleHitsPlayer(p(-17), p(-17), 17.9, 3, 2)).toBe(true);
  expect(vehicleHitsPlayer(p(), p(), 17.9, 3, 100)).toBe(true);
});
it('lane rejection retains complete Z/Y sweeps and advances distant traffic clocks', () => {
  const lane = { z: 3, speed: 0, direction: 1, offset: 0, positions: [0] };
  const road = new RoadChallenge([lane], 1, Infinity);
  const before = [
    { id: 'p1' as const, position: p(0, 0) },
    { id: 'p2' as const, position: p(0, 3, 3) },
    { id: 'p3' as const, position: p(0, 4.22) },
    { id: 'p4' as const, position: p(0, 20) },
  ];
  const after = before.map(player => ({ ...player, position: player.id === 'p1' ? p(0, 6) : player.id === 'p2' ? p() : player.position })).reverse();
  road.step(before, after, 1 / 60);
  expect(road.state().dead).toEqual(['p1', 'p2']);
  const distant = new RoadChallenge([{ ...lane, speed: 4 }], 1, Infinity);
  distant.step([before[3]!], [before[3]!], 3);
  expect(distant.state()).toMatchObject({ elapsedSeconds: 3, outcome: 'active', dead: [], vehicles: [{ x: 12 }] });
});
it('records simultaneous victims, freezes outcome/traffic and requires both players beyond finish', () => {
  const road = new RoadChallenge();
  const players = ['p1', 'p2'].map(id => ({ id: id as 'p1' | 'p2', position: p(4) }));
  road.step(players, players, 1 / 240);
  expect(road.state()).toMatchObject({ outcome: 'failed', dead: ['p1', 'p2'] });
  const terminal = road.state(); road.step(players, players, 100); expect(road.state()).toEqual(terminal);
  const clear = new RoadChallenge();
  const finish = players.map(player => ({ ...player, position: p(0, roadSettings.finishZ + 1) }));
  clear.step(players.map((player, i) => ({ ...player, position: finish[i]!.position })), finish, 1 / 240);
  expect(clear.state().outcome).toBe('cleared');
});
it('retains physical pulling, freezes whole assembly on death, rebuilds deterministic traffic and bounded bodies', () => {
  const sim = new FoundationSimulation(roadScenario.players, roadScenario.boxes, true, [], true);
  try {
    const initial = sim.roadState();
    for (let i = 0; i < 180; i++) sim.step({ p1: { x: 1, z: 0 } });
    expect(sim.state('p2').position.x).toBeGreaterThan(-1);
    expect(sim.fault).toBeUndefined();
    expect(sim.chainMetrics()!.maxAnchorError).toBeLessThan(0.3);
    sim.reset();
    for (let i = 0; i < 900 && sim.roadState()!.outcome === 'active'; i++) sim.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
    expect(sim.roadState()!.outcome).toBe('failed');
    const states = sim.states(), chain = sim.chainStates(), road = sim.roadState();
    for (let i = 0; i < 100; i++) sim.step({ p1: { x: 1, z: 1 } });
    expect(sim.states()).toEqual(states); expect(sim.chainStates()).toEqual(chain); expect(sim.roadState()).toEqual(road);
    for (let i = 0; i < 20; i++) {
      sim.reset(); expect(sim.roadState()).toEqual(initial);
      expect(sim.world.bodies.len()).toBe(14); expect(sim.world.impulseJoints.len()).toBe(13);
      expect(sim.world.colliders.len()).toBe(19);
    }
  } finally { sim.dispose(); }
});

it('offers a repeatable collision-free two-player crossing and freezes successful finish', () => {
  const sim = new FoundationSimulation(roadScenario.players, roadScenario.boxes, true, [], true);
  try {
    // Measured safe 4.5s launch phase for the .85 controlled-speed refinement.
    // The former 5s launch now reaches traffic later; hazards are unchanged.
    for (let i = 0; i < 270; i++) sim.step({});
    for (let i = 0; i < 300 && sim.roadState()!.outcome === 'active'; i++) sim.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
    expect(sim.roadState()!.outcome).toBe('cleared'); expect(sim.roadState()!.dead).toEqual([]);
    expect(sim.states().every(player => player.position.z > roadSettings.finishZ)).toBe(true);
    const finish = sim.states(); sim.step({ p1: { x: 0, z: 1 } }); expect(sim.states()).toEqual(finish);
  } finally { sim.dispose(); }
});
