import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { isLobbyMessage, isPrivateCode, isSnapshotMessage, privateRoomName, protocolVersion } from '@crossy/protocol';
import type { LobbyAction, LobbyMessage, LobbyRejection, SnapshotMessage, TransportMetadata, WelcomeMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
import { PrivateLobby } from './private-lobby.js';
const runtime = createServerRuntime(readServerConfig({})); let endpoint: string;
beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterAll(async () => { await runtime.stop(); });
const options = { protocolVersion }, origin = 'http://127.0.0.1:5173';
type R = Room<unknown, TransportMetadata>;
function harness() {
  const sdk = new Client(endpoint, { headers: { Origin: origin } });
  const rooms: R[] = [], welcome: (WelcomeMessage | undefined)[] = [], snapshots: (SnapshotMessage | undefined)[] = [], lobbies: (LobbyMessage | undefined)[] = [];
  const sequences = [0, 0], drive = [0, 0], rejects: LobbyRejection[] = [];
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
    async pair() {
      const first = await sdk.create<TransportMetadata>(privateRoomName, options); attach(first, 0);
      const second = await sdk.joinById<TransportMetadata>(first.roomId, options); attach(second, 1);
      await vi.waitFor(() => expect(!!lobbies[0] && !!lobbies[1] && !!welcome[0] && !!welcome[1]).toBe(true));
      return first.roomId;
    },
    async start() {
      command(0, 'ready'); command(1, 'ready');
      await vi.waitFor(() => expect(lobbies[0]!.players.every(p => p.ready)).toBe(true));
      command(0, 'start'); await vi.waitFor(() => expect([0, 1].every(index => snapshots[index]?.phase === 'running')).toBe(true));
    },
    async close() { clearInterval(timer); await Promise.all(rooms.map(r => r.connection.isOpen ? r.leave() : Promise.resolve())); },
  };
}
it('guards creation, freezes before host start, enforces ready/host/consensus and resets full road state', async () => {
  const h = harness();
  try {
    await expect(h.sdk.create(privateRoomName, { ...options, chainCourse: 'slack' })).rejects.toThrow();
    const code = await h.pair(); expect(isPrivateCode(code)).toBe(true); expect(h.rooms[0]!.reconnectionToken).not.toBe(code);
    await new Promise(r => setTimeout(r, 350));
    expect(h.snapshots[0]).toMatchObject({ tick: 0, phase: 'waiting', road: { elapsedSeconds: 0 } });
    h.command(1, 'start'); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('not-host'));
    await h.start(); const run = h.snapshots[0]!.runGeneration; expect(run).toBe(1);
    await expect(h.sdk.joinById(code, options)).rejects.toThrow();
    h.command(0, 'ready', { connectionGeneration: 999 }); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('stale-command'));
    h.rooms[1]!.send('reset', options); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('invalid-command'));
    await new Promise(r => setTimeout(r, 550));
    h.command(0, 'restart'); await vi.waitFor(() => expect(h.lobbies[1]!.players[0]!.restartRequested).toBe(true));
    expect(h.snapshots[0]!.runGeneration).toBe(run);
    h.command(1, 'restart'); await vi.waitFor(() => expect([0, 1].every(index => h.snapshots[index]?.runGeneration === run + 1)).toBe(true));
    expect(h.snapshots[0]!.players.every(p => p.position.z === -2)).toBe(true);
    expect(h.lobbies[0]!.players.every(p => !p.restartRequested)).toBe(true);
  } finally { await h.close(); }
}, 12_000);
it('reserves dropped seats, freezes traffic, transfers host, reclaims safely and returns to lobby on intentional leave', async () => {
  const h = harness();
  try {
    const code = await h.pair(); await h.start();
    const token = h.rooms[0]!.reconnectionToken, generation = h.welcome[0]!.connectionGeneration;
    h.rooms[0]!.connection.close();
    await vi.waitFor(() => expect(h.lobbies[1]).toMatchObject({ host: 'p2', stage: 'playing' }));
    await vi.waitFor(() => expect(h.snapshots[1]!.phase).toBe('paused')); const frozen = h.snapshots[1]!;
    await new Promise(r => setTimeout(r, 350));
    expect(h.snapshots[1]).toMatchObject({ tick: frozen.tick, road: frozen.road, players: frozen.players, chain: frozen.chain });
    await expect(h.sdk.joinById(code, options)).rejects.toThrow();
    const resumed = await h.sdk.reconnect<TransportMetadata>(token); h.attach(resumed, 0);
    await vi.waitFor(() => expect(h.welcome[0]!.connectionGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(h.snapshots[0]!.phase).toBe('running'));
    expect(h.lobbies[0]!.host).toBe('p2');
    const run = h.snapshots[1]!.runGeneration; await resumed.leave();
    await vi.waitFor(() => expect(h.lobbies[1]).toMatchObject({ host: 'p2', stage: 'lobby', players: [{ slot: 'p2', ready: false }] }));
    expect(h.snapshots[1]).toMatchObject({ runGeneration: run + 1, tick: 0, phase: 'waiting' });
    const replacement = await h.sdk.joinById<TransportMetadata>(code, options); h.attach(replacement, 0);
    await vi.waitFor(() => expect(h.lobbies[0]!.players).toHaveLength(2));
    expect(h.lobbies[0]!.players.every(p => !p.ready)).toBe(true);
  } finally { await h.close(); }
}, 12_000);
it('expires a real 30-second reservation and permits a replacement without continuing the forfeited run', async () => {
  const h = harness();
  try {
    const code = await h.pair(); await h.start();
    const token = h.rooms[0]!.reconnectionToken, run = h.snapshots[1]!.runGeneration;
    h.rooms[0]!.connection.close();
    await new Promise(r => setTimeout(r, 31_100));
    await expect(h.sdk.reconnect(token)).rejects.toThrow();
    expect(h.lobbies[1]).toMatchObject({ stage: 'lobby', host: 'p2', players: [{ slot: 'p2', ready: false }] });
    expect(h.snapshots[1]).toMatchObject({ runGeneration: run + 1, tick: 0, phase: 'waiting', road: { elapsedSeconds: 0 } });
    const replacement = await h.sdk.joinById<TransportMetadata>(code, options); h.attach(replacement, 0);
    await vi.waitFor(() => expect(h.lobbies[0]!.players).toHaveLength(2));
  } finally { await h.close(); }
}, 38_000);
it('closes an expired lobby with explicit notice and releases private room admission', async () => {
  const h = harness(); let expired: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const code = await h.pair(); let closed = false;
    h.rooms[0]!.onMessage('room-closed', value => { expect(value).toEqual({ protocolVersion, reason: 'idle-timeout' }); closed = true; });
    // The policy's exact ten-minute boundary is tested with an injected timestamp;
    // accelerate only this expiry predicate to exercise the actual timer/close path.
    expired = vi.spyOn(PrivateLobby.prototype, 'expired').mockReturnValue(true);
    await vi.waitFor(() => expect(closed && !h.rooms[0]!.connection.isOpen).toBe(true), { timeout: 2500 });
    expired.mockRestore(); expired = undefined;
    await expect(h.sdk.joinById(code, options)).rejects.toThrow();
    const a = await h.sdk.create<TransportMetadata>(privateRoomName, options), b = await h.sdk.create<TransportMetadata>(privateRoomName, options);
    h.attach(a, 0); h.attach(b, 1);
    await expect(h.sdk.create(privateRoomName, options)).rejects.toThrow();
  } finally { expired?.mockRestore(); await h.close(); }
}, 8000);

it('retains road death outcomes through reclaim and restricts terminal restart to the current host', async () => {
  const h = harness();
  try {
    await h.pair(); await h.start();
    // Exercise separate fresh gestures, as a person would after input safety
    // clears a held key. This lifecycle test must not depend on one unbroken
    // wall-clock lease; latency/expiry behavior has dedicated gates elsewhere.
    for (let gesture = 0; gesture < 6 && h.snapshots[0]?.phase !== 'ended'; gesture++) {
      h.drive[0] = h.drive[1] = 1;
      await new Promise(resolve => setTimeout(resolve, 650));
      h.drive[0] = h.drive[1] = 0;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await vi.waitFor(() => expect([0, 1].every(index => h.snapshots[index]?.phase === 'ended')).toBe(true), { timeout: 1000 });
    expect(h.snapshots[0]!.road!.outcome).toBe('failed'); h.drive[0] = h.drive[1] = 0;
    const end = h.snapshots[0]!, token = h.rooms[0]!.reconnectionToken;
    h.rooms[0]!.connection.close();
    await vi.waitFor(() => expect(h.lobbies[1]!.host).toBe('p2'));
    const resumed = await h.sdk.reconnect<TransportMetadata>(token); h.attach(resumed, 0);
    await vi.waitFor(() => expect(h.welcome[0] && h.lobbies[0] && h.snapshots[0]).toBeTruthy());
    expect(h.snapshots[0]).toMatchObject({ phase: 'ended', tick: end.tick, road: end.road, players: end.players, chain: end.chain });
    h.command(0, 'restart'); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('not-host'));
    h.command(1, 'restart'); await vi.waitFor(() => expect([0, 1].every(index => h.snapshots[index]?.runGeneration === end.runGeneration + 1)).toBe(true));
    expect(h.snapshots[0]!.road!.dead).toEqual([]);
  } finally { await h.close(); }
}, 12_000);
it('rejects spoofed/old lifecycle commands, rate-bounds actions and keeps private matchmaking origin-guarded', async () => {
  const h = harness();
  try {
    await h.pair();
    h.command(0, 'ready', { slot: 'p2' }); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('invalid-command'));
    h.command(0, 'start', { lobbyEpoch: -1 }); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('invalid-command'));
    h.command(0, 'ready', { lobbyEpoch: 999 }); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('stale-command'));
    expect(h.lobbies[0]!.players.every(p => !p.ready)).toBe(true);
    for (let i = 0; i < 12; i++) h.command(0, 'ready');
    await vi.waitFor(() => expect(h.rejects.some(r => r.reason === 'command-rate')).toBe(true));
    const disallowed = await fetch(`${endpoint}/matchmake/create/${privateRoomName}`, { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
    expect(disallowed.status).toBe(403);
    const listing = await fetch(`${endpoint}/matchmake/${privateRoomName}`, { headers: { Origin: origin } }); expect(listing.status).toBe(404);
  } finally { await h.close(); }
}, 8000);

it('validates owner-only room names, rejects stale/forged updates and preserves names through secure reconnect', async () => {
  const h = harness();
  const rename = (index: number, name: string, overrides = {}) => h.rooms[index]!.send('player-name', {
    protocolVersion, connectionGeneration: h.welcome[index]!.connectionGeneration,
    runGeneration: h.snapshots[index]?.runGeneration ?? 0, lobbyEpoch: h.lobbies[index]!.epoch,
    revision: h.lobbies[index]!.revision, name, ...overrides,
  });
  try {
    await h.pair(); rename(0, '  Jose\u0301  ');
    await vi.waitFor(() => expect(h.lobbies[1]!.players[0]!.displayName).toBe('José'));
    const revision = h.lobbies[0]!.revision;
    rename(1, 'Alex'); await vi.waitFor(() => expect(h.lobbies[0]!.players[1]!.displayName).toBe('Alex'));
    rename(0, 'Old', { revision }); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('stale-command'));
    const rejectCount = h.rejects.length;
    rename(1, 'Stolen', { slot: 'p1' }); await vi.waitFor(() => expect(h.rejects.length).toBeGreaterThan(rejectCount));
    expect(h.lobbies[1]!.players[0]!.displayName).toBe('José');
    const token = h.rooms[0]!.reconnectionToken;
    h.rooms[0]!.connection.close();
    await vi.waitFor(() => expect(h.lobbies[1]!.players[0]!.connected).toBe(false));
    const reclaimed = await h.sdk.reconnect<TransportMetadata>(token); h.attach(reclaimed,0);
    await vi.waitFor(() => expect(h.welcome[0]?.slot).toBe('p1'));
    await vi.waitFor(() => expect(h.lobbies[0]!.players[0]!.displayName).toBe('José'));
    h.command(0, 'ready'); h.command(1, 'ready');
    await vi.waitFor(() => expect(h.lobbies[1]!.players.every(p=>p.ready)).toBe(true));
    // Reclaim preserves the host transfer to p2; p1 must not gain ownership back.
    h.command(1, 'start');
    await vi.waitFor(() => expect(h.snapshots[0]!.phase).toBe('running'));
    rename(1, 'Late'); await vi.waitFor(() => expect(h.rejects.at(-1)?.reason).toBe('not-in-lobby'));
    expect(h.lobbies[0]!.players.map(p=>p.displayName)).toEqual(['José','Alex']);
  } finally { await h.close(); }
},15_000);
