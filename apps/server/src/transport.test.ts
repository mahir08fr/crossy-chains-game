import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import type { SeatReservation, Room } from '@colyseus/sdk';
import WebSocket from 'ws';
import { protocolVersion, transportRoomName } from '@crossy/protocol';
import type { InputExpiredMessage, InputMessage, SnapshotMessage, TransportMetadata, WelcomeMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';

type TestRoom = Room<unknown, TransportMetadata>;
const origin = 'http://127.0.0.1:5173';
const runtime = createServerRuntime(readServerConfig({}));
const rooms: TestRoom[] = [];
let endpoint: string;
const client = (headers = { Origin: origin }) => new Client(endpoint, { headers });
async function create(): Promise<TestRoom> {
  const room = await client().create<TransportMetadata>(transportRoomName, { protocolVersion });
  room.onMessage('snapshot', () => undefined);
  room.onMessage('input-expired', () => undefined);
  room.reconnection.enabled = false;
  rooms.push(room);
  await vi.waitFor(() => expect(room.state.players.size).toBe(1));
  return room;
}
async function join(id: string): Promise<TestRoom> {
  const room = await client().joinById<TransportMetadata>(id, { protocolVersion });
  room.onMessage('snapshot', () => undefined);
  room.onMessage('input-expired', () => undefined);
  room.reconnection.enabled = false;
  rooms.push(room);
  await vi.waitFor(() => expect(room.state.players.size).toBe(2));
  return room;
}
function message(room: TestRoom, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error(`Missing ${type} reply`)); }, 2000);
    const off = room.onMessage(type, (value: unknown) => { clearTimeout(timeout); off(); resolve(value); });
  });
}
async function input(room: TestRoom, slot: string, sequence = 1): Promise<InputMessage> {
  const welcome = message(room, 'welcome');
  room.send('hello', { protocolVersion });
  const reference = await welcome as WelcomeMessage;
  return { protocolVersion, sequence, connectionGeneration: room.state.players.get(slot)!.connectionGeneration,
    runGeneration: reference.runGeneration, referenceTimeMs: reference.serverTimeMs, x: 0, z: 0 };
}
async function post(path: string, body: unknown, requestOrigin = origin): Promise<Response> {
  return fetch(`${endpoint}${path}`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterEach(async () => { await Promise.all(rooms.splice(0).map((room) => room.connection.isOpen ? room.leave().catch(() => undefined) : Promise.resolve())); });
afterAll(async () => { await runtime.stop(); });

describe('real two-client transport', () => {
  it('guards reconnect requests with the existing origin, JSON shape and payload limits', async () => {
    const room = await create(); const path = `/matchmake/reconnect/${room.roomId}`;
    expect((await post(path, { reconnectionToken: 'invalid' }, 'https://unapproved.example')).status).toBe(403);
    expect((await post(path, { reconnectionToken: 'invalid', slot: 'p1' })).status).toBe(400);
    expect((await post(path, { reconnectionToken: '../invalid' })).status).toBe(400);
    expect((await post(path, { reconnectionToken: 'x'.repeat(5000) })).status).toBe(413);
  });

  it('reserves the dropped slot, pauses the world and reclaims with fresh input generations repeatedly', async () => {
    let first = await create(); const second = await join(first.roomId);
    const initial = await input(first, 'p1'); first.send('input', initial);
    second.send('input', await input(second, 'p2'));
    await vi.waitFor(() => expect(second.state.phase).toBe('running'));
    for (let cycle = 0; cycle < 2; cycle++) {
      const token = first.reconnectionToken;
      const oldGeneration = first.state.players.get('p1')!.connectionGeneration;
      first.connection.close(); rooms.splice(rooms.indexOf(first), 1);
      await vi.waitFor(() => expect(second.state.players.get('p1')!.connected).toBe(false));
      expect(second.state.phase).toBe('paused');
      await expect(client().joinById(first.roomId, { protocolVersion })).rejects.toThrow();
      await expect(client().reconnect(token + 'invalid')).rejects.toThrow();
      const resumed = await client().reconnect<TransportMetadata>(token);
      resumed.reconnection.enabled = false; resumed.onMessage('snapshot', () => undefined); resumed.onMessage('input-expired', () => undefined);
      rooms.push(resumed);
      await vi.waitFor(() => expect(second.state.players.get('p1')!.connected).toBe(true));
      expect(second.state.players.get('p1')!.connectionGeneration).toBeGreaterThan(oldGeneration);
      const rejected = message(resumed, 'rejected'); resumed.send('input', initial);
      expect(await rejected).toEqual({ code: 'invalid-generation' });
      const fresh = await input(resumed, 'p1');
      const needsNeutral = message(resumed, 'rejected'); resumed.send('input', { ...fresh, z: 1 });
      expect(await needsNeutral).toEqual({ code: 'requires-neutral' });
      resumed.send('input', fresh); second.send('input', await input(second, 'p2', cycle + 2));
      await vi.waitFor(() => expect(second.state.phase).toBe('running'));
      first = resumed;
    }
    await first.leave(); await vi.waitFor(() => expect(second.state.players.size).toBe(1));
    await expect(client().reconnect(first.reconnectionToken)).rejects.toThrow();
  });

  it('expires a real 30-second reservation and releases an empty room and admission slot', async () => {
    const first = await create(); const id = first.roomId, token = first.reconnectionToken;
    first.connection.close(); rooms.splice(rooms.indexOf(first), 1);
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    await expect(client().reconnect(token)).rejects.toThrow();
    await expect(client().joinById(id, { protocolVersion })).rejects.toThrow();
    expect(matchMaker.getLocalRoomById(id)).toBeUndefined();
    const replacement = await create(); expect(replacement.roomId).not.toBe(id);
    await create(); // both admission slots are available again
  }, 40_000);

  it('sustains held input with ordered delayed snapshots/inputs and clears only the genuinely silent owner', async () => {
    const first = await create(), second = await join(first.roomId);
    const clients = [first, second];
    const neutral = [await input(first, 'p1'), await input(second, 'p2')];
    const references = neutral.map((value) => value.referenceTimeMs);
    const sequences = [1, 1], deliveries = [0, 0];
    const expiries: InputExpiredMessage[][] = [[], []];
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const defer = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => { pending.delete(timer); callback(); }, delay);
      pending.add(timer);
    };
    for (const [index, room] of clients.entries()) {
      room.onMessage('input-expired', (message: InputExpiredMessage) => expiries[index]!.push(message));
      room.onMessage('rejected', () => undefined);
      room.onMessage('snapshot', (snapshot: SnapshotMessage) => defer(() => {
        references[index] = Math.max(references[index]!, snapshot.serverTimeMs);
      }, 90));
      room.send('input', neutral[index]!);
    }
    let sendSecond = true;
    const timer = setInterval(() => {
      for (const [index, room] of clients.entries()) {
        if (index === 1 && !sendSecond) continue;
        const sequence = ++sequences[index]!;
        const now = performance.now();
        // Maintain WebSocket order while varying uplink delay (head-of-line jitter).
        const delivery = Math.max(deliveries[index]! + 1, now + [20, 95, 25, 60][sequence % 4]!);
        deliveries[index] = delivery;
        const payload = { ...neutral[index]!, sequence, referenceTimeMs: references[index]!, z: 1 };
        defer(() => room.send('input', payload), delivery - now);
      }
    }, 1000 / 30);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(expiries).toEqual([[], []]);
      for (const room of clients) {
        expect(room.state.phase).toBe('running');
        expect(room.state.players.get('p1')!.acceptedInputs).toBeGreaterThan(20);
        expect(room.state.players.get('p2')!.acceptedInputs).toBeGreaterThan(20);
      }
      sendSecond = false;
      await vi.waitFor(() => expect(expiries[1]!.length).toBe(1), { interval: 10 });
      expect(expiries[1]![0]).toMatchObject({ slot: 'p2', connectionGeneration: neutral[1]!.connectionGeneration });
      expect(expiries[1]![0]!.silenceMs).toBeGreaterThanOrEqual(250);
      expect(expiries[0]).toEqual([]);
      await vi.waitFor(() => expect(first.state.phase).toBe('paused'));
      expect(first.state.players.get('p1')!.z).toBe(1);
    } finally { clearInterval(timer); for (const timer of pending) clearTimeout(timer); }
  });

  it('moves both players on one authoritative timeline, expires streams, clears on leave and resets generations', async () => {
    const first = await create(), second = await join(first.roomId);
    const snapshots: SnapshotMessage[][] = [[], []];
    for (const [index, room] of [first, second].entries()) room.onMessage('snapshot', (value: SnapshotMessage) => snapshots[index]!.push(value));
    const neutral1 = await input(first, 'p1'), neutral2 = await input(second, 'p2');
    first.send('input', neutral1); second.send('input', neutral2);
    first.send('input', { ...neutral1, sequence: 2, x: 1 });
    second.send('input', { ...neutral2, sequence: 2, x: -1 });
    await vi.waitFor(() => {
      const shared = snapshots[0]!.find((snapshot) => snapshot.tick >= 3 && snapshot.phase === 'running'
        && snapshots[1]!.some((other) => other.serverTimeMs === snapshot.serverTimeMs));
      expect(shared).toBeDefined();
      expect(shared!.players.map((player) => player.acknowledgedSequence)).toEqual([2, 2]);
      expect(shared!.players[0]!.position.x).toBeGreaterThan(0);
      expect(shared!.players[1]!.position.x).toBeLessThan(-2);
      expect(snapshots[1]!.find((other) => other.serverTimeMs === shared!.serverTimeMs)).toEqual(shared);
    }, { interval: 10 });
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)?.phase).toBe('paused'));
    const frozen = snapshots[0]!.at(-1)!;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(snapshots[0]!.at(-1)?.tick).toBe(frozen.tick);
    const rejected = message(first, 'rejected');
    first.send('input', { ...neutral1, sequence: 3, x: 1 });
    expect(await rejected).toEqual({ code: 'stale-input' });
    const fresh = await input(first, 'p1', 3);
    const heldRejected = message(first, 'rejected');
    first.send('input', { ...fresh, x: 1 });
    expect(await heldRejected).toEqual({ code: 'requires-neutral' });
    first.send('input', fresh);
    second.send('input', await input(second, 'p2', 3));
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)?.phase).toBe('running'), { interval: 10 });
    await second.leave(); rooms.splice(rooms.indexOf(second), 1);
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)?.phase).toBe('waiting'));
    const stoppedTick = snapshots[0]!.at(-1)!.tick;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(snapshots[0]!.at(-1)?.tick).toBe(stoppedTick);
    first.send('reset', { protocolVersion });
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)).toMatchObject({ runGeneration: 1, tick: 0, phase: 'waiting' }));
    expect(snapshots[0]!.at(-1)!.players[0]!.position.x).toBe(0);
    const resetLimited = message(first, 'rejected');
    first.send('reset', { protocolVersion });
    expect(await resetLimited).toEqual({ code: 'rate-limit' });
    const oldRun = message(first, 'rejected');
    first.send('input', { ...fresh, sequence: 4 });
    expect(await oldRun).toEqual({ code: 'invalid-generation' });
  });

  it('assigns distinct slots, synchronizes receipt state and returns a ping', async () => {
    const first = await create(), second = await join(first.roomId);
    await vi.waitFor(() => expect(first.state.players.size).toBe(2));
    const reply = message(first, 'probe-reply');
    first.send('probe', { protocolVersion, sequence: 1, clientTimeMs: 123 });
    expect(await reply).toMatchObject({ protocolVersion, sequence: 1, clientTimeMs: 123, slot: 'p1' });
    first.send('input', await input(first, 'p1'));
    second.send('input', await input(second, 'p2'));
    first.send('input', { ...await input(first, 'p1', 2), x: 1 });
    second.send('input', { ...await input(second, 'p2', 2), x: -1 });
    await vi.waitFor(() => {
      for (const room of [first, second]) {
        expect(room.state.players.get('p1')?.acceptedInputs).toBe(2);
        expect(room.state.players.get('p2')?.acceptedInputs).toBe(2);
        expect(room.state.players.get('p1')?.x).toBe(1);
        expect(room.state.players.get('p2')?.x).toBe(-1);
      }
      expect(first.state.revision).toBe(second.state.revision);
    });
  });

  it('rejects third participants and incompatible or client-selected slots', async () => {
    const first = await create();
    await expect(client().joinById(first.roomId, { protocolVersion: 2 })).rejects.toThrow();
    await expect(client().joinById(first.roomId, { protocolVersion, slot: 'p1' })).rejects.toThrow();
    await join(first.roomId);
    await expect(client().joinById(first.roomId, { protocolVersion })).rejects.toThrow();
    await expect(client().create(transportRoomName, { protocolVersion: 2 })).rejects.toThrow();
  });

  it('rejects spoofed input, non-finite axes, wrong generations, duplicate sequences and unknown messages', async () => {
    const room = await create();
    room.send('input', await input(room, 'p1'));
    await vi.waitFor(() => expect(room.state.players.get('p1')?.acceptedInputs).toBe(1));
    const cases: [string, unknown, string][] = [
      ['input', { ...await input(room, 'p1', 2), slot: 'p2' }, 'invalid-message'],
      ['input', { ...await input(room, 'p1', 2), x: NaN }, 'invalid-message'],
      ['input', { ...await input(room, 'p1', 2), connectionGeneration: 9999 }, 'invalid-generation'],
      ['input', { ...await input(room, 'p1', 2), runGeneration: 1 }, 'invalid-generation'],
      ['input', await input(room, 'p1'), 'old-sequence'],
      ['set-position', { x: 1000 }, 'invalid-message'],
    ];
    for (const [type, payload, code] of cases) {
      const rejected = message(room, 'rejected');
      room.send(type, payload);
      expect(await rejected).toEqual({ code });
    }
    expect(room.state.players.get('p1')?.acceptedInputs).toBe(1);
    room.send('input', await input(room, 'p1', 2));
    await vi.waitFor(() => expect(room.state.players.get('p1')?.acceptedInputs).toBe(2));
  });

  it('checks HTTP and WebSocket origins independently and validates bounded HTTP bodies', async () => {
    const room = await create();
    expect((await post(`/matchmake/create/${transportRoomName}`, { protocolVersion }, 'https://untrusted.example')).status).toBe(403);
    expect((await post(`/matchmake/create/${transportRoomName}`, { protocolVersion }, '')).status).toBe(403);
    expect((await post(`/matchmake/create/${transportRoomName}`, { padding: 'x'.repeat(5000) })).status).toBe(413);
    expect((await post(`/matchmake/create/${transportRoomName}`, { protocolVersion: 2 })).status).toBe(400);
    expect((await post(`/matchmake/joinOrCreate/${transportRoomName}`, { protocolVersion })).status).toBe(404);
    const preflight = await fetch(`${endpoint}/matchmake/joinById/${room.roomId}`, { method: 'OPTIONS', headers: { Origin: origin } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    const reservation = await post(`/matchmake/joinById/${room.roomId}`, { protocolVersion });
    expect(reservation.status).toBe(200);
    const seat = await reservation.json() as SeatReservation;
    const url = endpoint.replace('http:', 'ws:') + `/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}`;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { Origin: 'https://untrusted.example' } });
      socket.on('unexpected-response', (_req, response) => {
        expect(response.statusCode).toBe(403);
        response.resume(); socket.terminate(); resolve();
      });
      socket.on('open', () => { socket.close(); reject(new Error('Disallowed origin upgraded')); });
      socket.on('error', () => undefined);
    });
    // Consume the same reservation with an allowed origin to avoid retaining a seat.
    const recovered = await client().consumeSeatReservation<TransportMetadata>(seat);
    recovered.onMessage('snapshot', () => undefined);
    recovered.onMessage('input-expired', () => undefined);
    recovered.reconnection.enabled = false; rooms.push(recovered);
  });

  it('bounds chunked HTTP requests without relying on Content-Length', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${endpoint}/matchmake/create/${transportRoomName}`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject);
      req.write('x'.repeat(2500)); req.end('x'.repeat(2500));
    });
    expect(status).toBe(413);
  });

  it('bounds room admission and releases rooms after clients leave', async () => {
    const first = await create(), second = await create();
    await expect(client().create(transportRoomName, { protocolVersion })).rejects.toThrow('Local room limit');
    await first.leave(); rooms.splice(rooms.indexOf(first), 1);
    const replacement = await create();
    expect(replacement.roomId).not.toBe(first.roomId);
    expect(second.state.players.size).toBe(1);
  });

  it('removes a departing slot and assigns a fresh connection generation to its replacement', async () => {
    const first = await create(), second = await join(first.roomId);
    const generation = second.state.players.get('p2')!.connectionGeneration;
    await second.leave(); rooms.splice(rooms.indexOf(second), 1);
    await vi.waitFor(() => expect(first.state.players.has('p2')).toBe(false));
    const replacement = await join(first.roomId);
    expect(replacement.state.players.get('p2')!.connectionGeneration).toBeGreaterThan(generation);
    const rejected = message(replacement, 'rejected');
    replacement.send('input', { ...await input(replacement, 'p2'), connectionGeneration: generation });
    expect(await rejected).toEqual({ code: 'invalid-generation' });
  });

  it('disconnects oversized WebSocket payloads and excessive message rates', async () => {
    const oversized = await create();
    const closed = new Promise<void>((resolve) => oversized.onLeave(() => resolve()));
    oversized.send('input', { padding: 'x'.repeat(5000) });
    await closed;
    rooms.splice(rooms.indexOf(oversized), 1);
    const flooded = await create();
    const limited = new Promise<void>((resolve) => flooded.onLeave(() => resolve()));
    flooded.onMessage('probe-reply', () => undefined);
    for (let sequence = 0; sequence < 100; sequence++) flooded.send('probe', { protocolVersion, sequence, clientTimeMs: 0 });
    await limited;
    rooms.splice(rooms.indexOf(flooded), 1);
  });
});
