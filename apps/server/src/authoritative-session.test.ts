import { beforeAll, describe, expect, it } from 'vitest';
import { course, localPlayers, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';

beforeAll(initializePhysics);
describe('authoritative Foundation session', () => {
  it('matches the existing force-based simulation including obstacle contacts and consumed acknowledgments', () => {
    const session = new AuthoritativeSession();
    const direct = new FoundationSimulation(localPlayers, course, false);
    try {
      session.setPhase('running');
      for (let tick = 1; tick <= 240; tick++) {
        const inputs = { p1: { x: 0, z: 1 }, p2: { x: -1, z: 1 } };
        session.input('p1', 0, 1, tick);
        session.input('p2', -1, 1, tick);
        session.advance(settings.physics.tickSeconds);
        direct.step(inputs);
        expect(session.snapshot(tick).players.map(({ acknowledgedSequence: _ack, ...player }) => player))
          .toEqual(direct.states().map(({ tick: _tick, ...player }) => player));
      }
      const snapshot = session.snapshot(500);
      expect(isSnapshotMessage(snapshot)).toBe(true);
      expect(snapshot.tick).toBe(240);
      expect(snapshot.players[0]!.acknowledgedSequence).toBe(240);
      expect(snapshot.players[0]!.position.z).toBeLessThan(1);
    } finally { session.dispose(); direct.dispose(); }
  });

  it('waits, bounds catch-up and rebuilds the entire unchained world on repeated reset', () => {
    const session = new AuthoritativeSession();
    try {
      session.advance(1);
      expect(session.snapshot(0).tick).toBe(0);
      session.setPhase('running'); session.advance(1);
      expect(session.snapshot(0).tick).toBe(6);
      expect(session.snapshot(0).droppedSeconds).toBeCloseTo(0.9);
      for (let i = 0; i < 20; i++) {
        session.reset();
        expect(session.snapshot(0)).toMatchObject({ tick: 0, runGeneration: i + 1, phase: 'waiting' });
        expect(session.simulation.world.bodies.len()).toBe(2);
        expect(session.simulation.world.colliders.len()).toBe(11);
        expect(session.simulation.world.impulseJoints.len()).toBe(0);
      }
    } finally { session.dispose(); }
  });

  it('keeps measured and unmeasured chain snapshots identical through catch-up, pause and reset', () => {
    const measured = new AuthoritativeSession('road', 4), plain = new AuthoritativeSession('road', 4);
    const samples: [number, number][] = [];
    measured.onTickMeasured = (wall, cpu) => { samples.push([wall, cpu]); };
    try {
      for (const session of [measured, plain]) {
        session.advance(1);
        session.setPhase('running');
        session.input('p2', .2, 0, 1);
        session.advance(1);
      }
      expect(samples).toHaveLength(6);
      expect(samples.every(sample => sample.every(n => Number.isFinite(n) && n >= 0))).toBe(true);
      expect(measured.snapshot(123)).toEqual(plain.snapshot(123));
      for (const session of [measured, plain]) { session.setPhase('paused'); session.advance(1); session.reset(); }
      expect(samples).toHaveLength(6);
      expect(measured.snapshot(124)).toEqual(plain.snapshot(124));
    } finally { measured.dispose(); plain.dispose(); }
  });

  it('publishes the last safe state after a physics fault until explicit reset', () => {
    const session = new AuthoritativeSession();
    try {
      const safe = session.snapshot(0).players;
      session.simulation.world.bodies.forEach((body) => body.setLinvel({ x: 100, y: 0, z: 0 }, true));
      session.setPhase('running'); session.advance(settings.physics.tickSeconds);
      expect(session.snapshot(1)).toMatchObject({ phase: 'fault', tick: 0, players: safe });
      session.setPhase('running'); session.advance(1);
      expect(session.snapshot(2).tick).toBe(0);
      session.reset(); session.setPhase('running'); session.advance(settings.physics.tickSeconds);
      expect(session.snapshot(3)).toMatchObject({ phase: 'running', tick: 1, runGeneration: 1 });
    } finally { session.dispose(); }
  });
});
