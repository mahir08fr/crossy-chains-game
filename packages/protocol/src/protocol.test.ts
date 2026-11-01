import { describe, expect, it } from 'vitest';
import {
  isRoomOptions, isInputExpiredMessage, isInputMessage, isJoinOptions, isProbeMessage, isProbeReply, isRejectionMessage,
  isSnapshotMessage, isWelcomeMessage, protocolVersion,
} from './index';
import type { InputMessage, SnapshotMessage } from './index';

const input: InputMessage = { protocolVersion, sequence: 1, connectionGeneration: 0, runGeneration: 0, referenceTimeMs: 12.5, x: 1, z: -1 };
const snapshot: SnapshotMessage = {
  protocolVersion, scenarioVersion: 1, runGeneration: 0, tick: 60, serverTimeMs: 1000, phase: 'running', droppedSeconds: 0,
  players: ['p1', 'p2'].map((id) => ({ id: id as 'p1' | 'p2', position: { x: 0, y: 0.8, z: -5 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, acknowledgedSequence: 1 })),
};

describe('shared transport contract', () => {
  it('round-trips valid join, input, probe, welcome and motion messages', () => {
    const cases: [unknown, (value: unknown) => boolean][] = [
      [{ protocolVersion }, isJoinOptions], [input, isInputMessage], [snapshot, isSnapshotMessage],
      [{ protocolVersion, sequence: 0, clientTimeMs: 12 }, isProbeMessage],
      [{ protocolVersion, sequence: 0, clientTimeMs: 12, serverTimeMs: 20, slot: 'p1' }, isProbeReply],
      [{ protocolVersion, slot: 'p2', connectionGeneration: 0, runGeneration: 0, serverTimeMs: 20 }, isWelcomeMessage],
      [{ protocolVersion, slot: 'p1', connectionGeneration: 1, runGeneration: 0, serverTimeMs: 123, sequence: 9, silenceMs: 250 }, isInputExpiredMessage],
      [{ code: 'invalid-message' }, isRejectionMessage],
    ];
    for (const [value, validate] of cases) expect(validate(JSON.parse(JSON.stringify(value)))).toBe(true);
  });

  it('rejects malformed shapes, versions and client-authoritative fields', () => {
    for (const value of [null, [], undefined, 'input', {}, { ...input, protocolVersion: 2 }, { ...input, slot: 'p2' }, { ...input, position: { x: 100 } }]) {
      expect(isInputMessage(value)).toBe(false);
    }
    expect(isJoinOptions({ protocolVersion: 2 })).toBe(false);
    expect(isJoinOptions({ protocolVersion, slot: 'p1' })).toBe(false);
  });

  it('rejects non-finite, out-of-range axes and invalid sequence/generation/timing', () => {
    for (const x of [NaN, Infinity, -Infinity, 1.01, -1.01, '1']) expect(isInputMessage({ ...input, x })).toBe(false);
    for (const key of ['sequence', 'connectionGeneration', 'runGeneration']) {
      for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(isInputMessage({ ...input, [key]: value })).toBe(false);
    }
    expect(isInputMessage({ ...input, referenceTimeMs: -1 })).toBe(false);
    expect(isProbeMessage({ protocolVersion, sequence: 0, clientTimeMs: NaN })).toBe(false);
  });

  it('rejects oversized payloads and invalid or duplicated snapshot players', () => {
    expect(isInputMessage({ ...input, x: 'x'.repeat(5000) })).toBe(false);
    expect(isSnapshotMessage({ ...snapshot, players: [snapshot.players[0], snapshot.players[0]] })).toBe(false);
    expect(isSnapshotMessage({ ...snapshot, players: [snapshot.players[0]] })).toBe(false);
    expect(isSnapshotMessage({ ...snapshot, players: [snapshot.players[0], { ...snapshot.players[1], velocity: { x: NaN, y: 0, z: 0 } }] })).toBe(false);
    expect(isSnapshotMessage({ ...snapshot, tick: -1 })).toBe(false);
    expect(isInputExpiredMessage({ protocolVersion, slot: 'p1', connectionGeneration: 1, runGeneration: 0,
      serverTimeMs: 123, sequence: 9, silenceMs: -1 })).toBe(false);
    expect(isWelcomeMessage({ protocolVersion, slot: 'p5', connectionGeneration: 0, runGeneration: 0, serverTimeMs: 0 })).toBe(false);
    expect(isRejectionMessage({ code: 'unknown' })).toBe(false);
  });
});


describe('chain wire boundary', () => {
  const segment = { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  const chain = { course: 'post', endpoints: ['p1', 'p2'], segments: Array.from({ length: 12 }, () => structuredClone(segment)) };
  const assembly = { ...snapshot, scenarioVersion: 2, chain };
  it('allows only authored creation options and complete versioned assemblies', () => {
    expect(isRoomOptions({ protocolVersion, chainCourse: 'two-posts' })).toBe(true);
    expect(isRoomOptions({ protocolVersion, chainCourse: 'unknown' })).toBe(false);
    expect(isRoomOptions({ protocolVersion, chainCourse: 'post', position: 42 })).toBe(false);
    expect(isJoinOptions({ protocolVersion, chainCourse: 'post' })).toBe(false);
    expect(isSnapshotMessage(JSON.parse(JSON.stringify(assembly)))).toBe(true);
    for (const bad of [{ ...assembly, scenarioVersion: 1 }, { ...snapshot, scenarioVersion: 2 },
      { ...assembly, chain: { ...chain, endpoints: ['p2', 'p1'] } },
      { ...assembly, chain: { ...chain, segments: chain.segments.slice(1) } },
      { ...assembly, chain: { ...chain, segments: [...chain.segments, segment] } },
      { ...assembly, chain: { ...chain, course: 'foundation' } }]) expect(isSnapshotMessage(bad)).toBe(false);
  });
  it('rejects non-finite transforms, invalid rotations and unbounded poses', () => {
    for (const bad of [{ ...segment, position: { x: NaN, y: 0, z: 0 } },
      { ...segment, rotation: { x: 0, y: 0, z: 0, w: 0 } },
      { ...segment, rotation: { x: 0, y: 0, z: 0, w: Infinity } },
      { ...segment, extra: 'x'.repeat(9000) }]) {
      expect(isSnapshotMessage({ ...assembly, chain: { ...chain, segments: [bad, ...chain.segments.slice(1)] } })).toBe(false);
    }
  });
});
