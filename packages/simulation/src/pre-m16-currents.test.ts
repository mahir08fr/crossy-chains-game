import { beforeAll, expect, it } from 'vitest';
import { generateSection, playerMovementScale, riverSettings, sectionCenter, settings } from '@crossy/config';
import type { PlayerDefinition } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation.js';
beforeAll(initializePhysics);

function fixture(strength: 'normal' | 'fast', direction: -1 | 1, capacity = 1, land = false) {
  let seed = 0, section;
  for (; seed < 100; seed++) {
    section = Array.from({ length: 20 }, (_, i) => generateSection(seed, i)).find(s => s.river?.strength === strength && s.river.direction === direction);
    if (section) break;
  }
  if (!section) throw Error('Missing deterministic river');
  const definitions: PlayerDefinition[] = Array.from({ length: capacity }, (_, i) => ({ id: `p${i + 1}` as PlayerDefinition['id'], color: 0xffffff,
    spawn: { x: -direction * 1.3 + (capacity - 1) * .4 - i * .8, y: .8, z: sectionCenter(section) - (land ? 4 : 0) } }));
  return new FoundationSimulation(definitions, [], capacity > 1, [], false, false, false, seed);
}

it('scales only both controlled target speeds by exactly fifteen percent', () => {
  expect(playerMovementScale).toBe(.85);
  expect(settings.player.speed).toBe(7.5 * .85);
  expect(riverSettings.speed).toBe(2.1 * .85);
  expect(riverSettings.speed / settings.player.speed).toBeCloseTo(2.1 / 7.5, 14);
  expect(settings.player.acceleration).toBe(28);
  expect(settings.physics.tickSeconds).toBe(1 / 60);
});

it.each([-1, 1] as const)('regresses imperceptible normal drift using actual Rapier displacement, direction %i', direction => {
  const measured: number[] = [];
  for (const strength of ['normal', 'fast'] as const) {
    const sim = fixture(strength, direction);
    try {
      const start = sim.state().position.x;
      for (let i = 0; i < 120; i++) sim.step({});
      const displacement = (sim.state().position.x - start) * direction;
      // Original 2 m/s² normal water moves only ~.10m in this two-second
      // fixture. This assertion fails if that weak original recipe returns.
      expect(displacement).toBeGreaterThan(strength === 'normal' ? .7 : 1.6);
      expect(sim.fault).toBeUndefined();
      measured.push(displacement);
      const end = sim.states(); sim.reset();
      for (let i = 0; i < 120; i++) sim.step({});
      expect(sim.states()).toEqual(end);
    } finally { sim.dispose(); }
  }
  expect(measured[1]!).toBeGreaterThan(measured[0]! * 2);
});

it.each(['normal', 'fast'] as const)('%s water assists downstream input and opposes upstream input without affecting land', strength => {
  const movement: number[] = [];
  for (const input of [-1, 0, 1]) {
    const sim = fixture(strength, 1);
    try {
      const start = sim.state().position.x;
      for (let i = 0; i < 60; i++) sim.step({ p1: { x: input, z: 0 } });
      movement.push(sim.state().position.x - start);
      expect(sim.fault).toBeUndefined();
    } finally { sim.dispose(); }
  }
  expect(movement[0]!).toBeLessThan(movement[1]!);
  expect(movement[2]!).toBeGreaterThan(movement[1]! + .4);
  const dry = fixture(strength, 1, 1, true);
  try {
    const x = dry.state().position.x;
    for (let i = 0; i < 120; i++) dry.step({});
    expect(dry.state().position.x).toBe(x);
    expect(dry.generatedState()!.water.players[0]!.exposureSeconds).toBe(0);
  } finally { dry.dispose(); }
});

it.each([2, 3, 4])('%i linked wet players all drift through physical constraints with bounded errors', capacity => {
  const sim = fixture('fast', 1, capacity);
  try {
    const start = sim.states();
    for (let i = 0; i < 90; i++) sim.step({});
    for (const [i, p] of sim.states().entries()) expect(p.position.x - start[i]!.position.x).toBeGreaterThan(.8);
    expect(sim.chainMetricsAll().every(m => m.maxAnchorError < .03)).toBe(true);
    expect(sim.generatedState()!.water.players.every(p => p.exposureSeconds > 1.4)).toBe(true);
    expect(sim.fault).toBeUndefined();
  } finally { sim.dispose(); }
});
