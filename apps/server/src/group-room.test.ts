import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { isLobbyMessage, isSnapshotMessage, privateRoomName, protocolVersion } from '@crossy/protocol';
import type { LobbyAction, LobbyMessage, LobbyRejection, SnapshotMessage, TransportMetadata, WelcomeMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
const runtime = createServerRuntime(readServerConfig({})); let endpoint: string;
beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterAll(async () => { await runtime.stop(); });
const options = { protocolVersion }, origin = 'http://127.0.0.1:5173';
type R = Room<unknown, TransportMetadata>;
function harness() {
  const sdk = new Client(endpoint, { headers: { Origin: origin } });
  const rooms: R[] = [], welcome: (WelcomeMessage | undefined)[] = [], snapshots: (SnapshotMessage | undefined)[] = [], lobbies: (LobbyMessage | undefined)[] = [];
  const sequences = [0, 0, 0, 0], drive = [0, 0, 0, 0], rejects: LobbyRejection[] = [];
  const attach = (room: R, index: number) => {
    rooms[index] = room; welcome[index] = undefined; snapshots[index] = undefined; lobbies[index] = undefined; sequences[index] = 0;
    room.reconnection.enabled = false; room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage('welcome', (value: WelcomeMessage) => { welcome[index] = value; });
    room.onMessage('snapshot', (value: SnapshotMessage) => { expect(isSnapshotMessage(value)).toBe(true); snapshots[index] = value; });
    room.onMessage('lobby', (value: LobbyMessage) => { expect(isLobbyMessage(value)).toBe(true); lobbies[index] = value; });
    room.onMessage('rejected', () => undefined); room.onMessage('lobby-rejected', (value: LobbyRejection) => { rejects.push(value); });
    room.onMessage('input-expired', () => { drive[index] = 0; }); room.onMessage('room-closed', () => undefined);
    room.send('hello', options);
  };
  const timer = setInterval(() => rooms.forEach((room, index) => {
    const owner = welcome[index], snapshot = snapshots[index];
    if (!owner || !room.connection.isOpen) return;
    room.send('input', { protocolVersion, sequence: ++sequences[index]!, connectionGeneration: owner.connectionGeneration,
      runGeneration: snapshot?.runGeneration ?? owner.runGeneration, referenceTimeMs: Math.max(owner.serverTimeMs, snapshot?.serverTimeMs ?? 0), x: 0, z: drive[index] ?? 0 });
  }), 1000 / 30);
  const command = (index: number, action: LobbyAction, overrides = {}) => rooms[index]!.send('lobby', { protocolVersion,
    connectionGeneration: welcome[index]!.connectionGeneration, runGeneration: snapshots[index]?.runGeneration ?? welcome[index]!.runGeneration,
    lobbyEpoch: lobbies[index]!.epoch, action, ...overrides });
  return { sdk, rooms, welcome, snapshots, lobbies, rejects, drive, attach, command,
    async pair(capacity: 2 | 3 | 4 = 2) {
      const first = await sdk.create<TransportMetadata>(privateRoomName, { ...options, capacity }); attach(first, 0);
      for (let i = 1; i < capacity; i++) attach(await sdk.joinById<TransportMetadata>(first.roomId, options), i);
      await vi.waitFor(() => expect(Array.from({ length: capacity }, (_, i) => !!lobbies[i] && !!welcome[i]).every(Boolean)).toBe(true));
      return first.roomId;
    },
    async start() {
      rooms.forEach((_, i) => command(i, 'ready'));
      await vi.waitFor(() => expect(lobbies[0]!.players.every(p => p.ready)).toBe(true));
      command(rooms.findIndex((_, i) => welcome[i]?.slot === lobbies[i]?.host), 'start'); await vi.waitFor(() => expect(rooms.every((_, index) => snapshots[index]?.phase === 'running')).toBe(true));
    },
    async close() { clearInterval(timer); await Promise.all(rooms.map(r => r.connection.isOpen ? r.leave() : Promise.resolve())); },
  };
}

for (const capacity of [2, 3, 4] as const) {
  it(`${capacity}-seat private room owns distinct slots, enforces capacity and unanimous restart`, async () => {
    const h = harness();
    try {
      const code = await h.pair(capacity);
      expect(h.lobbies[0]!.capacity).toBe(capacity);
      expect(h.welcome.map(w => w!.slot)).toEqual(['p1', 'p2', 'p3', 'p4'].slice(0, capacity));
      expect(new Set(h.rooms.map(r => r.reconnectionToken)).size).toBe(capacity);
      await expect(h.sdk.joinById(code, options)).rejects.toThrow();
      expect(h.snapshots[0]?.tick ?? 0).toBe(0);
      await h.start(); const run = h.snapshots[0]!.runGeneration;
      expect(h.snapshots[0]!.chain!.segments).toHaveLength(12 * (capacity - 1));
      await new Promise(r => setTimeout(r, 550));
      for (let i = 0; i < capacity - 1; i++) h.command(i, 'restart');
      await vi.waitFor(() => expect(h.lobbies[0]!.players.filter(p => p.restartRequested)).toHaveLength(capacity - 1));
      expect(h.snapshots[0]!.runGeneration).toBe(run);
      h.command(0, 'cancel-restart');
      await vi.waitFor(() => expect(h.lobbies[0]!.players[0]!.restartRequested).toBe(false));
      h.command(capacity - 1, 'restart'); h.command(0, 'restart');
      await vi.waitFor(() => expect(h.snapshots.every(s => s!.runGeneration === run + 1)).toBe(true));
      expect(h.snapshots[0]!.players.every(p => p.position.z === -2)).toBe(true);
    } finally { await h.close(); }
  }, 12_000);
}
it('four-player host transfer/reclaim/expiry/replacement preserve exact seats and clear stale ownership', async () => {
  const h = harness();
  try {
    const code = await h.pair(4); await h.start();
    const token = h.rooms[0]!.reconnectionToken, generation = h.welcome[0]!.connectionGeneration;
    h.rooms[0]!.connection.close();
    await vi.waitFor(() => expect(h.lobbies[1]!.host).toBe('p2'));
    await vi.waitFor(() => expect(h.snapshots[1]!.phase).toBe('paused'));
    const frozen = h.snapshots[1]!;
    await new Promise(r => setTimeout(r, 350));
    expect(h.snapshots[1]).toMatchObject({ tick: frozen.tick, players: frozen.players, chain: frozen.chain, road: frozen.road });
    await expect(h.sdk.joinById(code, options)).rejects.toThrow();
    h.attach(await h.sdk.reconnect<TransportMetadata>(token), 0);
    await vi.waitFor(() => expect(h.welcome[0]!.connectionGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(h.snapshots[0]!.phase).toBe('running'));
    expect(h.welcome[0]!.slot).toBe('p1'); expect(h.lobbies[0]!.host).toBe('p2');
    const rejected: string[] = []; h.rooms[0]!.onMessage('rejected', value => rejected.push(value.code));
    const packet = { protocolVersion, sequence: 100_000, connectionGeneration: generation, runGeneration: h.snapshots[0]!.runGeneration,
      referenceTimeMs: h.snapshots[0]!.serverTimeMs, x: 1, z: 0 };
    h.rooms[0]!.send('input', packet);
    await vi.waitFor(() => expect(rejected).toContain('invalid-generation'));
    h.rooms[0]!.send('input', { ...packet, connectionGeneration: h.welcome[0]!.connectionGeneration, slot: 'p4' });
    await vi.waitFor(() => expect(rejected).toContain('invalid-message'));
    const expiredToken = h.rooms[2]!.reconnectionToken, run = h.snapshots[1]!.runGeneration;
    h.rooms[2]!.connection.close();
    await new Promise(r => setTimeout(r, 31_100));
    await expect(h.sdk.reconnect(expiredToken)).rejects.toThrow();
    expect(h.lobbies[1]).toMatchObject({ capacity: 4, host: 'p2', stage: 'lobby' });
    expect(h.snapshots[1]).toMatchObject({ runGeneration: run + 1, tick: 0, phase: 'waiting' });
    expect(h.lobbies[1]!.players.every(p => !p.ready && !p.restartRequested)).toBe(true);
    h.attach(await h.sdk.joinById<TransportMetadata>(code, options), 2);
    await vi.waitFor(() => expect(h.welcome[2]!.slot).toBe('p3'));
    await h.start();
  } finally { await h.close(); }
}, 42_000);
it('rejects invalid creator sizes and joining capacity overrides', async () => {
  const h = harness();
  try {
    for (const capacity of [0, 1, 5, 3.5, '4', null]) await expect(h.sdk.create(privateRoomName, { ...options, capacity })).rejects.toThrow();
    const first = await h.sdk.create<TransportMetadata>(privateRoomName, { ...options, capacity: 4 }); h.attach(first, 0);
    await expect(h.sdk.joinById(first.roomId, { ...options, capacity: 2 })).rejects.toThrow();
  } finally { await h.close(); }
}, 8000);
