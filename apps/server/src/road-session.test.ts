import { beforeAll, expect, it } from 'vitest';
import { roadScenario } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';
beforeAll(initializePhysics);
it('publishes atomic road poses/death, preserves terminal state through phase changes, and resets everything', () => {
  const session = new AuthoritativeSession('road');
  const direct = new FoundationSimulation(roadScenario.players, roadScenario.boxes, true, [], true);
  try {
    session.setPhase('running');
    for (let i = 1; i < 900 && session.phase === 'running'; i++) {
      session.input('p1', 0, 1, i); session.input('p2', 0, 1, i);
      session.advance(1 / 60); direct.step({ p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } });
      const snapshot = session.snapshot(i);
      expect(isSnapshotMessage(snapshot)).toBe(true);
      expect(snapshot.road).toEqual(direct.roadState());
      expect(snapshot.players.map(p => p.position)).toEqual(direct.states().map(p => p.position));
      expect(snapshot.chain!.segments.map(s => s.position)).toEqual(direct.chainStates().map(s => s.position));
    }
    const ended = session.snapshot(1000);
    expect(ended).toMatchObject({ phase: 'ended', road: { outcome: 'failed' } });
    session.snapshot(1001).road!.dead.length = 0;
    for (const phase of ['waiting', 'paused', 'running'] as const) { session.setPhase(phase); session.advance(1); }
    expect(session.snapshot(1002)).toMatchObject({ tick: ended.tick, phase: 'ended', road: ended.road, chain: ended.chain, players: ended.players });
    session.reset();
    expect(session.snapshot(1003)).toMatchObject({ runGeneration: 1, tick: 0, phase: 'waiting', road: { dead: [], elapsedSeconds: 0, outcome: 'active' } });
    expect(isSnapshotMessage(session.snapshot(1004))).toBe(true);
    session.setPhase('running'); session.advance(1 / 60);
    const paused = session.snapshot(1005); session.setPhase('paused'); session.advance(100);
    expect(session.snapshot(1006)).toMatchObject({ tick: paused.tick, road: paused.road, players: paused.players, chain: paused.chain });
  } finally { session.dispose(); direct.dispose(); }
});
it('strictly rejects forged/malformed road snapshots while retaining Foundation and M2 compatibility', () => {
  const session = new AuthoritativeSession('road');
  try {
    const good = session.snapshot(0);
    const cases: ((s: typeof good) => void)[] = [
      s => { s.road!.vehicles[0]!.x = NaN; }, s => { s.road!.vehicles[0]!.id = 1; },
      s => { s.road!.vehicles[0]!.lane = 2; }, s => { s.road!.vehicles.push(s.road!.vehicles[0]!); },
      s => { s.road!.vehicles[0]!.x = 19; }, s => { s.road!.dead = ['p1']; },
      s => { s.road!.outcome = 'failed'; }, s => { s.phase = 'ended'; },
      s => { delete s.road; }, s => { s.scenarioVersion = 2; }, s => { s.chain!.course = 'slack'; },
    ];
    for (const mutate of cases) { const bad = structuredClone(good); mutate(bad); expect(isSnapshotMessage(bad)).toBe(false); }
    expect(isSnapshotMessage(good)).toBe(true);
  } finally { session.dispose(); }
});
