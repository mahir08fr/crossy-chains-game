import { beforeAll, expect, it } from 'vitest';
import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';

beforeAll(initializePhysics);
const cases = Array.from({ length: 31 }, (_, i) => i * 3).flatMap(idle => [0, 1, 3].map(offset => ({ idle, offset })));

// The original one-pass solver faults at (18,0) and (42,1). Arrival skew and
// settled contact history matter, so retain the complete bounded startup grid.
it.each(cases)('two-post startup idle=$idle, input skew=$offset stays within unchanged safety limits', ({ idle, offset }) => {
  const scenario = scenarios.find(s => s.id === 'two-posts')!;
  const sim = new FoundationSimulation(scenario.players, scenario.boxes, true, scenario.obstacles);
  try {
    for (let tick = 0; tick < idle; tick++) sim.step({});
    for (let tick = 0; tick < 200; tick++) sim.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: tick >= offset ? 1 : 0 } });
    expect(sim.fault).toBeUndefined();
    expect(sim.state().tick).toBe(idle + 200);
    expect(sim.chainStates()).toHaveLength(12);
    expect(sim.chainMetrics()!.maxAnchorError).toBeLessThan(settings.faults.anchorGap);
    expect(sim.states().every(p => p.position.z > 1)).toBe(true);
    sim.reset();
    expect(sim.world.integrationParameters.numInternalPgsIterations).toBe(2);
  } finally { sim.dispose(); }
});
