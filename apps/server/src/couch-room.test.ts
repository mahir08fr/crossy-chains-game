import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { couchRoomName, privateRoomName, isControllerStatus, isDisplayWelcome, isSnapshotMessage, unpackSnapshot, protocolVersion, isCouchHealth } from '@crossy/protocol';
import type { ControllerStatus, CouchHealth, DisplayWelcome, LobbyAction, LobbyMessage, SnapshotMessage, WelcomeMessage } from '@crossy/protocol';
import { TransportTestRoom } from './transport-room.js';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
const runtime = createServerRuntime(readServerConfig({})); let endpoint: string;
const liveRooms = new Set<TransportTestRoom>();
const originalCreate = TransportTestRoom.prototype.onCreate, originalDispose = TransportTestRoom.prototype.onDispose;
const createSpy = vi.spyOn(TransportTestRoom.prototype, 'onCreate').mockImplementation(async function(this: TransportTestRoom, options) {
  await originalCreate.call(this, options); liveRooms.add(this);
});
const disposeSpy = vi.spyOn(TransportTestRoom.prototype, 'onDispose').mockImplementation(function(this: TransportTestRoom) {
  originalDispose.call(this); liveRooms.delete(this);
});
// Client socket closure precedes asynchronous framework disposal. Verify actual
// cleanup between independent cases instead of racing the shared two-room cap.
afterEach(async () => { await vi.waitFor(() => expect(liveRooms.size).toBe(0), { timeout: 2500 }); });
beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterAll(async () => { await runtime.stop(); createSpy.mockRestore(); disposeSpy.mockRestore(); });
const pv = { protocolVersion }, displayOptions = { ...pv, role: 'display', displaySecret: 'a'.repeat(32) }, phoneOptions = { ...pv, role: 'controller' };
type R = Room;
function harness() {
  const sdk = new Client(endpoint, { headers: { Origin: 'http://127.0.0.1:5173' } });
  const rooms: R[] = [], owners: (WelcomeMessage | DisplayWelcome | undefined)[] = [], lobbies: (LobbyMessage | undefined)[] = [];
  const controls: (ControllerStatus | undefined)[] = [], rejections: string[][] = [], sequences: number[] = [], drives: number[] = [];
  const health: CouchHealth[] = [];
  let forward = false;
  let snapshot: SnapshotMessage | undefined, displayActive = true, pulse = true, phoneSnapshots = 0, closed = false;
  const attach = (room: R, i: number) => {
    rooms[i] = room; owners[i] = undefined; controls[i] = undefined; sequences[i] = 0; drives[i] = 0; rejections[i] = [];
    room.reconnection.enabled = false; room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage('couch-health', (m: CouchHealth) => { expect(isCouchHealth(m)).toBe(true); if (i === 0) health.push(m); });
    room.onMessage('welcome', (m: WelcomeMessage) => { owners[i] = m; });
    room.onMessage('display-welcome', (m: DisplayWelcome) => { expect(isDisplayWelcome(m)).toBe(true); owners[i] = m; });
    room.onMessage('lobby', (m: LobbyMessage) => { lobbies[i] = m; });
    room.onMessage('controller-status', (m: ControllerStatus) => { expect(i).toBeGreaterThan(0); expect(isControllerStatus(m)).toBe(true); controls[i] = m; });
    const receive = (m: SnapshotMessage) => { if (i > 0) phoneSnapshots++; else { expect(isSnapshotMessage(m)).toBe(true); snapshot = m; } };
    room.onMessage('snapshot', receive); room.onMessage('snapshot-compact', m => receive(unpackSnapshot(m)!));
    room.onMessage('rejected', (m: { code: string }) => { rejections[i]!.push(m.code); if (m.code === 'requires-neutral') drives[i] = 0; });
    room.onMessage('lobby-rejected', (m: { reason: string }) => { rejections[i]!.push(m.reason); });
    room.onMessage('input-expired', () => { drives[i] = 0; });
    room.onMessage('room-closed', () => { closed = true; });
    room.send('hello', { ...pv, snapshotFormat: 'flat-chain-v1' });
    room.send('couch-health', pv);
  };
  const timer = setInterval(() => {
    rooms.forEach((room, i) => {
      if (!room.connection.isOpen || !owners[i]) return;
      if (i === 0) { if (pulse) room.send('display-heartbeat', { ...pv, active: displayActive }); return; }
      const status = controls[i], owner = owners[i]!;
      room.send('input', { ...pv, sequence: ++sequences[i]!, connectionGeneration: owner.connectionGeneration,
        runGeneration: status?.runGeneration ?? owner.runGeneration, referenceTimeMs: status?.serverTimeMs ?? owner.serverTimeMs,
        x: forward ? 0 : drives[i] ?? 0, z: forward ? drives[i] ?? 0 : 0 });
    });
  }, 1000 / 30);
  const command = (i: number, action: LobbyAction, extra = {}) => rooms[i]!.send('lobby', { ...pv, action,
    connectionGeneration: owners[i]!.connectionGeneration, runGeneration: snapshot!.runGeneration, lobbyEpoch: lobbies[i]!.epoch, ...extra });
  return { sdk, health, rooms, owners, lobbies, controls, drives, rejections, attach, command,
    set forward(value: boolean) { forward = value; },
    get snapshot() { return snapshot!; }, get phoneSnapshots() { return phoneSnapshots; }, get closed() { return closed; },
    set displayActive(value: boolean) { displayActive = value; }, set pulse(value: boolean) { pulse = value; },
    async create(capacity: number) {
      const display = await sdk.create(couchRoomName, { ...displayOptions, capacity }); attach(display, 0);
      for (let i = 1; i <= capacity; i++) attach(await sdk.joinById(display.roomId, phoneOptions), i);
      await vi.waitFor(() => expect(owners.filter(Boolean)).toHaveLength(capacity + 1));
      await vi.waitFor(() => expect(lobbies[0]?.players).toHaveLength(capacity));
      await vi.waitFor(() => expect(snapshot).toBeDefined());
      return display.roomId;
    },
    async start() {
      for (let i = 1; i < rooms.length; i++) command(i, 'ready');
      await vi.waitFor(() => expect(lobbies[0]!.players.every(p => p.ready)).toBe(true));
      command(0, 'start'); await vi.waitFor(() => expect(snapshot?.phase).toBe('running'));
    },
    async close() { clearInterval(timer); if (rooms[0]?.connection.isOpen) await rooms[0].leave(); for (const room of rooms.slice(1)) if (room.connection.isOpen) await room.leave().catch(() => undefined); },
  };
}
for (const capacity of [2, 3, 4]) it(`couch ${capacity}: display has no seat, strict roles/ownership, all-ready start, unanimous restart and no world data on phones`, async () => {
  const h = harness();
  try {
    const code = await h.create(capacity);
    expect(h.lobbies[0]!.players.map(p => p.slot)).toEqual(['p1', 'p2', 'p3', 'p4'].slice(0, capacity));
    await expect(h.sdk.joinById(code, pv)).rejects.toThrow();
    await expect(h.sdk.joinById(code, displayOptions)).rejects.toThrow();
    await expect(h.sdk.joinById(code, phoneOptions)).rejects.toThrow();
    h.command(0, 'ready'); await vi.waitFor(() => expect(h.rejections[0]).toContain('invalid-command'));
    h.command(0, 'start'); await vi.waitFor(() => expect(h.rejections[0]).toContain('not-ready'));
    await h.start(); const before = h.snapshot;
    h.rooms[0]!.send('input', { ...pv, sequence: 1, connectionGeneration: h.owners[1]!.connectionGeneration, runGeneration: before.runGeneration, referenceTimeMs: before.serverTimeMs, x: 1, z: 0 });
    await vi.waitFor(() => expect(h.rejections[0]).toContain('invalid-message'));
    h.rooms[1]!.send('input', { ...pv, sequence: 999, connectionGeneration: h.owners[2]!.connectionGeneration, runGeneration: before.runGeneration, referenceTimeMs: before.serverTimeMs, x: 1, z: 0 });
    await vi.waitFor(() => expect(h.rejections[1]).toContain('invalid-generation'));
    // Malformed-packet probes can straddle the start's neutral reset. Wait for
    // a fresh, acknowledged neutral before issuing this one new movement gesture.
    // An expiry during that gesture still clears it and fails the assertion.
    h.drives[1] = 0;
    await vi.waitFor(() => {
      expect(h.health.at(-1)?.streams.find(s => s.slot === 'p1')?.requiresNeutral).toBe(false);
      expect(performance.now() - h.controls[1]!.serverTimeMs).toBeLessThan(100);
      expect(h.snapshot.phase).toBe('running');
    });
    h.drives[1] = .65;
    await vi.waitFor(() => expect(h.snapshot.players[0]!.position.x, JSON.stringify({phase:h.snapshot.phase,tick:h.snapshot.tick,rejections:h.rejections,drives:h.drives,health:h.health.slice(-3)})).toBeGreaterThan(before.players[0]!.position.x + .1), { timeout: 2000 }); h.drives[1] = 0;
    expect(h.phoneSnapshots).toBe(0); expect(h.controls[1]).not.toHaveProperty('players'); expect(h.snapshot.chain!.segments).toHaveLength(12 * (capacity - 1));
    await new Promise(r => setTimeout(r, 550)); h.command(0, 'restart'); await vi.waitFor(() => expect(h.rejections[0]).toContain('invalid-command'));
    for (let i = 1; i < capacity; i++) h.command(i, 'restart');
    await vi.waitFor(() => expect(h.lobbies[0]!.players.filter(p => p.restartRequested)).toHaveLength(capacity - 1));
    expect(h.snapshot.runGeneration).toBe(before.runGeneration);
    h.command(capacity, 'restart'); await vi.waitFor(() => expect(h.snapshot.runGeneration).toBe(before.runGeneration + 1));
    expect(h.snapshot.players.every(p => p.position.z === -2)).toBe(true);
  } finally { await h.close(); }
}, 12_000);
it('pauses on display hide, missing heartbeat and drop; only its secret reclaims display; explicit display leave closes room', async () => {
  const h = harness();
  try {
    const code = await h.create(2); await h.start(); h.displayActive = false;
    await vi.waitFor(() => expect(h.snapshot.phase).toBe('paused')); const frozen = h.snapshot;
    expect(h.health.some(m => m.blockers.some(b => b.reason === 'display-inactive'))).toBe(true);
    await new Promise(r => setTimeout(r, 300)); expect(h.snapshot).toMatchObject({ tick: frozen.tick, players: frozen.players, chain: frozen.chain, road: frozen.road });
    h.displayActive = true; await vi.waitFor(() => expect(h.snapshot.phase).toBe('running'));
    h.pulse = false; await vi.waitFor(() => expect(h.snapshot.phase).toBe('paused'), { timeout: 3600 });
    expect(h.health.some(m => m.blockers.some(b => b.reason === 'display-heartbeat-stale'))).toBe(true);
    h.pulse = true; await vi.waitFor(() => expect(h.snapshot.phase).toBe('running'));
    const token = h.rooms[0]!.reconnectionToken, generation = h.owners[0]!.connectionGeneration;
    h.rooms[0]!.connection.close(); await vi.waitFor(() => expect(h.controls[1]?.displayActive).toBe(false));
    await expect(h.sdk.joinById(code, displayOptions)).rejects.toThrow();
    h.attach(await h.sdk.reconnect(token), 0);
    await vi.waitFor(() => expect(h.owners[0]!.connectionGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(h.snapshot.phase).toBe('running'));
    await h.rooms[0]!.leave(); await vi.waitFor(() => expect(h.closed && !h.rooms[1]!.connection.isOpen).toBe(true));
    await expect(h.sdk.joinById(code, phoneOptions)).rejects.toThrow();
  } finally { await h.close(); }
}, 12_000);
it('phone drop transfers host, reserves exact slot, rotates generation, preserves world and opens replacement lobby on leave', async () => {
  const h = harness();
  try {
    const code = await h.create(3); await h.start(); const token = h.rooms[1]!.reconnectionToken, generation = h.owners[1]!.connectionGeneration;
    h.rooms[1]!.connection.close(); await vi.waitFor(() => expect(h.snapshot.phase).toBe('paused'));
    await vi.waitFor(() => expect(h.lobbies[0]!.host).toBe('p2')); const frozen = h.snapshot;
    await new Promise(r => setTimeout(r, 300)); expect(h.snapshot.tick).toBe(frozen.tick);
    h.attach(await h.sdk.reconnect(token), 1);
    await vi.waitFor(() => expect(h.owners[1]!.connectionGeneration).toBeGreaterThan(generation));
    expect(h.owners[1]).toMatchObject({ slot: 'p1' }); expect(h.lobbies[0]!.host).toBe('p2');
    await vi.waitFor(() => expect(h.snapshot.phase).toBe('running'));
    await h.rooms[1]!.leave(); await vi.waitFor(() => expect(h.lobbies[0]!.stage).toBe('lobby'));
    h.attach(await h.sdk.joinById(code, phoneOptions), 1);
    await vi.waitFor(() => expect(h.owners[1]).toMatchObject({ slot: 'p1' }));
    expect(h.lobbies[0]!.players.every(p => !p.ready)).toBe(true); expect(h.snapshot.tick).toBe(0);
  } finally { await h.close(); }
}, 10_000);
it('retains real 30-second phone reservation expiry and closes after a real 30-second display reservation expires', async () => {
  const h = harness();
  try {
    const code = await h.create(2); await h.start();
    const phoneToken = h.rooms[1]!.reconnectionToken, displayToken = h.rooms[0]!.reconnectionToken;
    h.rooms[1]!.connection.close(); h.rooms[0]!.connection.close();
    const droppedAt = performance.now();
    // Observe the server's expiry boundary before probing the now-expired
    // tokens; a fixed client sleep can race disposal under scheduling delays.
    await vi.waitFor(() => expect(h.closed && !h.rooms[2]!.connection.isOpen).toBe(true), { timeout: 33_000, interval: 50 });
    expect(performance.now() - droppedAt).toBeGreaterThanOrEqual(29_000);
    await expect(h.sdk.reconnect(phoneToken)).rejects.toThrow();
    await expect(h.sdk.reconnect(displayToken)).rejects.toThrow();
    await expect(h.sdk.joinById(code, phoneOptions)).rejects.toThrow();
    // Colyseus intentionally schedules empty-room cleanup one second after
    // an expired reservation. Await real disposal/admission release too.
    await vi.waitFor(() => expect(![...liveRooms].some(room => room.roomId === code)).toBe(true), { timeout: 2500 });
  } finally { await h.close(); }
}, 37_000);
it('blocks controller-created rooms and role mixing with existing desktop private rooms', async () => {
  const h = harness(); let desktop: R | undefined;
  try {
    await expect(h.sdk.create(couchRoomName, phoneOptions)).rejects.toThrow();
    await expect(h.sdk.create(couchRoomName, { ...displayOptions, slot: 'p1' })).rejects.toThrow();
    desktop = await h.sdk.create(privateRoomName, pv); desktop.onMessage('*', () => undefined);
    await expect(h.sdk.joinById(desktop.roomId, phoneOptions)).rejects.toThrow();
    const code = await h.create(2); await expect(h.sdk.joinById(code, pv)).rejects.toThrow();
  } finally { await desktop?.leave(); await h.close(); }
}, 10_000);

it('delivers shared death to every phone without poses and permits display terminal restart only after every seat reconnects', async () => {
  const h = harness();
  try {
    await h.create(2); await h.start(); h.forward = true;
    for (let gesture = 0; gesture < 7 && h.snapshot.phase !== 'ended'; gesture++) {
      h.drives[1] = h.drives[2] = 1; await new Promise(r => setTimeout(r, 650));
      h.drives[1] = h.drives[2] = 0; await new Promise(r => setTimeout(r, 100));
    }
    await vi.waitFor(() => expect(h.snapshot.phase).toBe('ended'));
    await vi.waitFor(() => expect(h.controls.slice(1).every(s => s?.outcome === 'failed' && s.phase === 'ended')).toBe(true));
    const end = h.snapshot, token = h.rooms[2]!.reconnectionToken; h.rooms[2]!.connection.close();
    await vi.waitFor(() => expect(h.lobbies[0]!.players[1]!.connected).toBe(false));
    h.command(0, 'restart'); await vi.waitFor(() => expect(h.rejections[0]).toContain('need-two-players'));
    h.attach(await h.sdk.reconnect(token), 2);
    await vi.waitFor(() => expect(h.owners[2]).toBeDefined());
    await vi.waitFor(() => expect(h.lobbies[0]!.players.every(p => p.connected)).toBe(true));
    expect(h.snapshot).toMatchObject({ tick: end.tick, road: end.road });
    h.command(0, 'restart'); await vi.waitFor(() => expect(h.snapshot.runGeneration).toBe(end.runGeneration + 1));
    expect(h.snapshot.road!.outcome).toBe('active'); expect(h.phoneSnapshots).toBe(0);
  } finally { await h.close(); }
}, 12_000);

it('binds the not-yet-consumed creator reservation so the public code cannot race for display authority', async () => {
  const h = harness();
  try {
    // Stop before the creator opens its WebSocket. The public code exists but
    // no display member has joined, which used to be an unbound-role window.
    const response = await fetch(`${endpoint}/matchmake/create/${couchRoomName}`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...displayOptions, capacity: 2 }),
    });
    expect(response.status).toBe(200);
    const reservation = await response.json() as Parameters<Client['consumeSeatReservation']>[0];
    await expect(h.sdk.joinById(reservation.roomId, { ...pv, role: 'display' })).rejects.toThrow();
    await expect(h.sdk.joinById(reservation.roomId, { ...displayOptions, displaySecret: 'b'.repeat(32) })).rejects.toThrow();
    await expect(h.sdk.joinById(reservation.roomId, phoneOptions)).rejects.toThrow();
    h.attach(await h.sdk.consumeSeatReservation(reservation), 0);
    await vi.waitFor(() => expect(h.owners[0]).toMatchObject({ role: 'display' }));
    expect(h.lobbies[0]!.players).toEqual([]);
  } finally { await h.close(); }
}, 8000);

it('binds controller diagnostics to the owning generation and slot', async () => {
  const h = harness();
  try {
    await h.create(2); await h.start();
    const send = (extra = {}) => h.rooms[1]!.send('controller-diagnostic', { ...pv,
      connectionGeneration: h.owners[1]!.connectionGeneration, event: 'sender-stall', detail: { gapMs: 350 }, ...extra });
    send({ connectionGeneration: h.owners[1]!.connectionGeneration + 1 });
    send({ slot: 'p2' }); send({ detail: { token: 'unapproved' } });
    await new Promise(r => setTimeout(r, 120));
    expect(h.health.every(m => m.reports.length === 0)).toBe(true);
    send();
    await vi.waitFor(() => expect(h.health.some(m => m.reports.some(r => r.slot === 'p1' && r.event === 'sender-stall' && r.detail.gapMs === 350))).toBe(true));
    expect(h.snapshot.phase).toBe('running'); // telemetry cannot control safety
  } finally { await h.close(); }
}, 8000);

it('synchronizes four phone names to shared display, denies display renames and restores the secure reclaimed seat', async () => {
  const h = harness();
  const rename = (i: number, name: string) => h.rooms[i]!.send('player-name', { ...pv,
    connectionGeneration: h.owners[i]!.connectionGeneration, runGeneration: h.snapshot.runGeneration,
    lobbyEpoch: h.lobbies[i]!.epoch, revision: h.lobbies[i]!.revision, name });
  try {
    await h.create(4);
    for (let i=1;i<=4;i++) {
      rename(i,['Goose friend','Axie','Capy','🦄'][i-1]!);
      await vi.waitFor(()=>expect(h.lobbies[0]!.players[i-1]!.displayName).toBe(['Goose friend','Axie','Capy','🦄'][i-1]));
    }
    expect(h.lobbies[4]!.players.map(p=>p.displayName)).toEqual(['Goose friend','Axie','Capy','🦄']);
    rename(0,'Display theft');await vi.waitFor(()=>expect(h.rejections[0]).toContain('invalid-command'));
    const token=h.rooms[3]!.reconnectionToken;h.rooms[3]!.connection.close();
    await vi.waitFor(()=>expect(h.lobbies[0]!.players[2]!.connected).toBe(false));
    h.attach(await h.sdk.reconnect(token),3);
    await vi.waitFor(()=>expect(h.owners[3] && 'slot' in h.owners[3] && h.owners[3].slot).toBe('p3'));
    await vi.waitFor(()=>expect(h.lobbies[3]!.players[2]!.displayName).toBe('Capy'));
    await h.start();expect(h.phoneSnapshots).toBe(0);
    await new Promise(r=>setTimeout(r,550));
    for(let i=1;i<=4;i++)h.command(i,'restart');
    const run=h.snapshot.runGeneration;
    await vi.waitFor(()=>expect(h.snapshot.runGeneration).toBeGreaterThan(run));
    expect(h.lobbies[0]!.players.map(p=>p.displayName)).toEqual(['Goose friend','Axie','Capy','🦄']);
  } finally { await h.close(); }
},20_000);
