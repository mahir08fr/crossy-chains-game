import { beforeAll, describe, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { protocolVersion } from '@crossy/protocol';
import type { ChainCourse, InputMessage, PlayerSlot } from '@crossy/protocol';
import { InputScheduler } from '../../server/src/input-scheduler';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { NetworkInputSender } from './network-input';
import { SnapshotBuffer } from './snapshot-buffer';

beforeAll(initializePhysics);
const profiles = [
  { name: 'loopback', rtt: 0, jitter: 0, holdEvery: 0 },
  { name: '50 ms', rtt: 50, jitter: 0, holdEvery: 0 },
  { name: '100 ms ±20', rtt: 100, jitter: 20, holdEvery: 0 },
  { name: '150 ms ±30 +1% holds', rtt: 150, jitter: 30, holdEvery: 100 },
  { name: '250 ms ±50 +3% holds', rtt: 250, jitter: 50, holdEvery: 33 },
  { name: '2-second interruption', rtt: 100, jitter: 20, holdEvery: 0, interruption: true },
];
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;

// Deterministic message-level impairment: ordered queues and retransmission-like
// holds, not physical packet loss. Uses real scheduler, physics, sender and buffer.
function exercise(profile: typeof profiles[number], chainCourse?: ChainCourse) {
  const session = new AuthoritativeSession(chainCourse);
  const neutral = chainCourse ? new AuthoritativeSession(chainCourse) : undefined;
  const neutralBuffers = [new SnapshotBuffer(), new SnapshotBuffer()];
  const queue: { at: number; deliver: () => void }[] = [];
  let time = 0, seed = 17, messages = 0, bytes = 0, expiries = 0, maxQueue = 0;
  const rtts: number[] = [], ages: number[] = [], stepCosts: number[] = [];
  const references = [0, 0], sequences = [0, 0], intent = [0, 0];
  const buffers = [new SnapshotBuffer(), new SnapshotBuffer()];
  const deadlines = [0, 0, 0, 0];
  const snapshots = [new Map<number, string>(), new Map<number, string>()];
  let peakExcess = 0, peakContacts = 0, peakRenderedGap = 0, maxSnapshotBytes = 0;
  const spawnZ = session.snapshot(0).players[0]!.position.z;
  let firstVisible = Infinity, twoCentimetres = Infinity, runningTicks = 0, pausedTicks = 0, freshAfterPause = false;
  const blocked = () => profile.interruption && time >= 3500 && time < 5500;
  const delay = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return Math.max(0, profile.rtt / 2 + ((seed / 2 ** 32) * 2 - 1) * profile.jitter / 2);
  };
  const transmit = (lane: number, payload: unknown, deliver: () => void) => {
    if (blocked()) return;
    messages++; bytes += JSON.stringify(payload).length;
    const hold = profile.holdEvery && messages % profile.holdEvery === 0 ? 120 : 0;
    const at = Math.max(deadlines[lane]!, time + delay() + hold);
    deadlines[lane] = at;
    queue.push({ at, deliver }); maxQueue = Math.max(maxQueue, queue.length);
  };
  const scheduler = new InputScheduler((slot, _sequence, _silence, now) => {
    expiries++; const index = slot === 'p1' ? 0 : 1;
    scheduler.issueReference(slot, now);
    transmit(index * 2 + 1, { expiry: now }, () => { intent[index] = 0; references[index] = now; });
  });
  const senders = buffers.map((_buffer, index) => new NetworkInputSender((x, z) => {
    const packet: InputMessage = { protocolVersion, sequence: ++sequences[index]!, connectionGeneration: index + 1,
      runGeneration: 0, referenceTimeMs: references[index]!, x, z };
    transmit(index * 2, packet, () => scheduler.accept(index === 0 ? 'p1' : 'p2', packet, 0, time));
  }));
  for (const [index, buffer] of buffers.entries()) {
    const slot: PlayerSlot = index === 0 ? 'p1' : 'p2';
    scheduler.connect(slot, index + 1, 0); scheduler.issueReference(slot, 0);
    buffer.observeClock(0, -profile.rtt / 2, profile.rtt / 2);
    neutralBuffers[index]!.observeClock(0, -profile.rtt / 2, profile.rtt / 2);
  }
  try {
    for (time = 0; time <= 10_000; time++) {
      queue.sort((a, b) => a.at - b.at);
      while (queue[0] && queue[0].at <= time) { const event = queue.shift()!; if (!blocked()) event.deliver(); }
      if (time === 1000) {
        for (const index of chainCourse ? [0, 1] : [0]) { intent[index] = 1; senders[index]!.update(time, { x: 0, z: 1 }, buffers[index]!.ageMs(time) < 250); }
      } // Real keydown sends immediately.
      if (time === 6500) { intent[0] = chainCourse ? -1 : 1; if (chainCourse) intent[1] = -1; freshAfterPause = true; }
      if (time % 33 === 0) {
        for (const [index, buffer] of buffers.entries()) {
          const ready = buffer.ageMs(time) < 250;
          if (!ready) intent[index] = 0;
          const z = ready && buffer.latest?.phase === 'running' ? intent[index]! : 0;
          senders[index]!.update(time, { x: 0, z }, ready);
        }
      }
      if (time % 17 === 0) {
        scheduler.expire(time); session.setPhase(scheduler.ready ? 'running' : 'paused');
        for (const slot of ['p1', 'p2'] as const) { const value = scheduler.latest(slot); session.input(slot, value.x, value.z, value.sequence); }
        const start = performance.now(); session.advance(0.017); stepCosts.push(performance.now() - start);
        if (neutral) { neutral.setPhase(session.phase === 'running' ? 'running' : 'paused'); neutral.advance(.017); }
        if (chainCourse) { peakExcess = Math.max(peakExcess, session.simulation.chainMetrics()!.excessRatio); peakContacts = Math.max(peakContacts, session.simulation.obstacleContacts().ids.length); }
        if (session.phase === 'running') runningTicks++; else pausedTicks++;
      }
      if (time % 50 === 0) {
        const snapshot = session.snapshot(time), neutralSnapshot = neutral?.snapshot(time);
        maxSnapshotBytes = Math.max(maxSnapshotBytes, JSON.stringify(snapshot).length);
        for (const [index, buffer] of buffers.entries()) {
          scheduler.issueReference(index === 0 ? 'p1' : 'p2', time);
          transmit(index * 2 + 1, snapshot, () => {
            references[index] = snapshot.serverTimeMs;
            if (neutralSnapshot) neutralBuffers[index]!.push(neutralSnapshot, time);
            if (buffer.push(snapshot, time)) snapshots[index]!.set(snapshot.tick, JSON.stringify([snapshot.players, snapshot.chain]));
          });
        }
      }
      if (time % 1000 === 0) {
        for (const index of [0, 1]) {
          const sent = time;
          transmit(index * 2, { probe: sent }, () => {
            const serverTime = time;
            transmit(index * 2 + 1, { probe: serverTime }, () => {
              rtts.push(time - sent); buffers[index]!.observeClock(serverTime, sent, time); neutralBuffers[index]!.observeClock(serverTime, sent, time);
            });
          });
        }
      }
      if (time % 16 === 0 && time > 1000) {
        for (const [index, buffer] of buffers.entries()) {
          const frame = buffer.sample(time);
          if (!frame) continue;
          if (frame.chain) {
            const anchor = (index: number, sign: number) => {
              const { position: p, rotation: q } = frame.chain!.segments[index]!;
              return { x: p.x + sign * .25 * 2 * (q.x * q.y - q.w * q.z),
                y: p.y + sign * .25 * (1 - 2 * (q.x * q.x + q.z * q.z)),
                z: p.z + sign * .25 * 2 * (q.y * q.z + q.w * q.x) };
            };
            const pairs = [[frame.players[0]!.position, anchor(0, -1)],
              ...frame.chain.segments.slice(1).map((_, i) => [anchor(i, 1), anchor(i + 1, -1)]),
              [anchor(11, 1), frame.players[1]!.position]];
            for (const [a, b] of pairs) peakRenderedGap = Math.max(peakRenderedGap, Math.hypot(a!.x - b!.x, a!.y - b!.y, a!.z - b!.z));
          }
          ages.push(frame.ageMs); expect(buffer.size).toBeLessThanOrEqual(32);
          expect(frame.players.every((player) => Object.values(player.position).every(Number.isFinite))).toBe(true);
          const baselineZ = neutral ? neutralBuffers[index]!.sample(time)?.players[0]!.position.z ?? spawnZ : spawnZ;
          if (index === 0 && time < 3500 && frame.players[0]!.position.z > baselineZ + .001) firstVisible = Math.min(firstVisible, time - 1000);
          if (index === 0 && time < 3500 && frame.players[0]!.position.z > baselineZ + .02) twoCentimetres = Math.min(twoCentimetres, time - 1000);
        }
      }
    }
    for (const [tick, state] of snapshots[0]!) if (snapshots[1]!.has(tick)) expect(snapshots[1]!.get(tick)).toBe(state);
    expect(session.phase).not.toBe('fault');
    expect(session.simulation.world.bodies.len()).toBe(chainCourse ? 14 : 2); expect(session.simulation.world.colliders.len()).toBe(chainCourse ? 21 : 11);
    if (chainCourse) {
      expect(peakExcess).toBeLessThan(.05);
      if (profile.rtt <= 150) {
        expect(peakContacts).toBe(2);
        expect(session.simulation.obstacleContacts().ids).toEqual([]);
        expect(session.snapshot(time).players.every(({ position }) => position.z < 1)).toBe(true);
      }
    }
    expect(maxQueue).toBeLessThan(256);
    const result = { profile: profile.name, ...(chainCourse ? { chainCourse, peakExcess, peakContacts, peakRenderedGap, maxSnapshotBytes } : {}), rttMedian: percentile(rtts, .5), rttP95: percentile(rtts, .95),
      snapshotAgeP95: percentile(ages, .95), responseMs: Number.isFinite(firstVisible) ? firstVisible : null,
      twoCentimetresMs: Number.isFinite(twoCentimetres) ? twoCentimetres : null, expiryEvents: expiries, pausedTicks, runningTicks, payloadKiBPerSec: +(bytes / 1024 / 10).toFixed(2),
      advanceP95Ms: +percentile(stepCosts, .95).toFixed(3), maxQueue };
    if (profile.rtt <= 100 && !profile.interruption) { expect(expiries).toBe(0); expect(firstVisible).toBeLessThanOrEqual(180); }
    if (profile.interruption) { expect(expiries).toBeGreaterThan(0); expect(freshAfterPause).toBe(true); expect(session.phase).toBe('running'); }
    return result;
  } finally { session.dispose(); neutral?.dispose(); }
}

describe('repeatable message-delay performance matrix', () => {
  it.each(profiles)('$name maintains coherent authoritative state and unchanged safety limits', (profile) => {
    const first = exercise(profile), repeat = exercise(profile);
    expect({ ...repeat, advanceP95Ms: 0 }).toEqual({ ...first, advanceP95Ms: 0 });
    console.info('[M4 message performance]', JSON.stringify(first));
  });
});


describe('networked chain message-delay matrix', () => {
  it.each(profiles)('$name keeps the physical assembly coherent without client simulation', (profile) => {
    const first = exercise(profile, 'two-posts'), repeat = exercise(profile, 'two-posts');
    expect({ ...repeat, advanceP95Ms: 0 }).toEqual({ ...first, advanceP95Ms: 0 });
    console.info('[M5 message performance]', JSON.stringify(first));
  });
});
