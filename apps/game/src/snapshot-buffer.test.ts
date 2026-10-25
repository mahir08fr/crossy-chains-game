import { describe, expect, it } from 'vitest';
import { protocolVersion } from '@crossy/protocol';
import type { SnapshotMessage } from '@crossy/protocol';
import { SnapshotBuffer } from './snapshot-buffer';
function snapshot(serverTimeMs: number, tick: number, x: number, runGeneration = 0): SnapshotMessage {
  return { protocolVersion, scenarioVersion: 1, runGeneration, tick, serverTimeMs, phase: 'running', droppedSeconds: 0,
    players: ['p1', 'p2'].map((id, index) => ({ id: id as 'p1' | 'p2',
      position: { x: x + index * 10, y: 1, z: 0 }, velocity: { x, y: 0, z: 0 },
      grounded: true, acknowledgedSequence: tick })),
  };
}
describe('shared snapshot presentation', () => {
  it('interpolates both players and velocities on one timeline and holds rather than extrapolating', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1000, 60, 0), 5000);
    buffer.push(snapshot(1100, 66, 10), 5100);
    const middle = buffer.sample(5125)!;
    expect(middle.players.map((player) => player.position.x)).toEqual([5, 15]);
    expect(middle.players.map((player) => player.velocity.x)).toEqual([5, 5]);
    expect(middle.holding).toBe(false);
    expect(buffer.sample(5300)!.players.map((player) => player.position.x)).toEqual([10, 20]);
    expect(buffer.sample(5300)!.holding).toBe(true);
    expect(buffer.sample(5500)!.ageMs).toBe(400);
  });
  it('rejects old runs/ticks/times, accepts paused ticks, clears on reset and bounds memory', () => {
    const buffer = new SnapshotBuffer(75, 4);
    for (let i = 0; i < 10; i++) buffer.push(snapshot(1000 + i * 50, i, i), 5000 + i * 50);
    expect(buffer.size).toBe(4);
    expect(buffer.push(snapshot(1460, 8, 100), 5500)).toBe(false);
    expect(buffer.push(snapshot(1450, 9, 100), 5500)).toBe(false);
    expect(buffer.push({ ...snapshot(1500, 9, 9), phase: 'paused' }, 5500)).toBe(true);
    expect(buffer.push(snapshot(1550, 0, 0, 1), 5550)).toBe(true);
    expect(buffer.size).toBe(1);
    expect(buffer.sample(5550)!.players[0]!.position.x).toBe(0);
    expect(buffer.push(snapshot(1600, 10, 100), 5600)).toBe(false);
    buffer.clear();
    expect(buffer.sample(6000)).toBeUndefined();
    expect(buffer.ageMs(6000)).toBe(Infinity);
    expect(buffer.push(snapshot(10, 0, 0), 6000)).toBe(true);
  });
  it('detects delayed backlog despite recent arrival using the aligned server clock', () => {
    const buffer = new SnapshotBuffer();
    buffer.observeClock(1000, 4990, 5010);
    buffer.push(snapshot(1000, 1, 0), 6000);
    expect(buffer.ageMs(6000)).toBe(1000);
    expect(buffer.sample(6000)!.ageMs).toBe(1000);
    buffer.push(snapshot(2010, 2, 10), 6010);
    expect(buffer.ageMs(6010)).toBe(0);
  });
  it('uses monotonic ping clock alignment and prevents clock correction from reversing presentation', () => {
    const buffer = new SnapshotBuffer(0);
    buffer.observeClock(1000, 4990, 5010);
    buffer.push(snapshot(1000, 1, 0), 5010);
    buffer.push(snapshot(1100, 2, 10), 5110);
    expect(buffer.sample(5050)!.players[0]!.position.x).toBe(5);
    buffer.observeClock(1010, 5059, 5061); // lower RTT, negative clock correction
    expect(buffer.sample(5061)!.players[0]!.position.x).toBe(5);
    buffer.observeClock(2000, 5060, 5160); // queued/high RTT sample ignored
    expect(buffer.sample(5061)!.players[0]!.position.x).toBe(5);
  });
});

describe('whole-assembly presentation', () => {
  function assembly(time: number, tick: number, x: number, sign = 1): SnapshotMessage {
    return { ...snapshot(time, tick, x), scenarioVersion: 2, chain: { course: 'post', endpoints: ['p1', 'p2'],
      segments: Array.from({ length: 12 }, (_, i) => ({ position: { x: x + i / 2, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: sign } })) } };
  }
  it('uses the player bracket/alpha for every segment, shortest-path rotations and no extrapolation', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(assembly(1000, 60, 0), 5000); buffer.push(assembly(1100, 66, 10, -1), 5100);
    const frame = buffer.sample(5125)!;
    expect(frame.players[0]!.position.x).toBe(5);
    expect(frame.chain!.segments.map(({ position }) => position.x)).toEqual(Array.from({ length: 12 }, (_, i) => 5 + i / 2));
    for (const { rotation } of frame.chain!.segments) expect(rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(buffer.sample(5500)!.chain!.segments[0]!.position.x).toBe(10);
    expect(buffer.push({ ...assembly(1200, 70, 20), chain: { ...frame.chain!, course: 'barrier' } }, 5200)).toBe(false);
    expect(buffer.push({ ...assembly(1200, 0, 0), runGeneration: 1 }, 5200)).toBe(true);
    expect(buffer.size).toBe(1); expect(buffer.sample(5200)!.chain!.segments[0]!.position.x).toBe(0);
    buffer.clear(); expect(buffer.sample(5201)).toBeUndefined();
  });
  it('spherically interpolates an actual rotation with unit length', () => {
    const buffer = new SnapshotBuffer(0), first = assembly(1000, 60, 0), second = assembly(1100, 66, 10);
    second.chain!.segments.forEach((segment) => { segment.rotation = { x: 0, y: 1, z: 0, w: 0 }; });
    buffer.push(first, 5000); buffer.push(second, 5100);
    const q = buffer.sample(5050)!.chain!.segments[0]!.rotation;
    expect(q.y).toBeCloseTo(Math.SQRT1_2); expect(q.w).toBeCloseTo(Math.SQRT1_2);
  });
});
