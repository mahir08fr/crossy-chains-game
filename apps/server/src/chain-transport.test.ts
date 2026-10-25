import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { protocolVersion, transportRoomName, isSnapshotMessage } from '@crossy/protocol';
import type { SnapshotMessage, TransportMetadata, WelcomeMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';

const runtime = createServerRuntime(readServerConfig({}));
let endpoint: string;
beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterAll(async () => { await runtime.stop(); });
type TestRoom = Room<unknown, TransportMetadata>;
it('replicates the entire cable, pauses on drop, safely reclaims and resets both observers', async () => {
  const sdk = new Client(endpoint, { headers: { Origin: 'http://127.0.0.1:5173' } });
  const rooms: TestRoom[] = [];
  const owners: (WelcomeMessage | undefined)[] = [], latest: (SnapshotMessage | undefined)[] = [];
  const sequences = [0, 0], drive = [0, 0];
  const observed = [new Map<string, string>(), new Map<string, string>()];
  let timer: ReturnType<typeof setInterval> | undefined;
  const attach = (room: TestRoom, index: number) => {
    room.reconnection.enabled = false; room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage('welcome', (message: WelcomeMessage) => { owners[index] = message; sequences[index] = 0; });
    room.onMessage('input-expired', () => { drive[index] = 0; });
    room.onMessage('rejected', () => undefined);
    room.onMessage('snapshot', (snapshot: SnapshotMessage) => {
      expect(isSnapshotMessage(snapshot)).toBe(true); latest[index] = snapshot;
      expect(snapshot.chain!.course).toBe('post');
      observed[index]!.set(`${snapshot.runGeneration}:${snapshot.tick}`, JSON.stringify([snapshot.players, snapshot.chain]));
    });
    room.send('hello', { protocolVersion });
  };
  try {
    await expect(sdk.create(transportRoomName, { protocolVersion, chainCourse: 'invalid' })).rejects.toThrow();
    const first = await sdk.create<TransportMetadata>(transportRoomName, { protocolVersion, chainCourse: 'post' }); rooms.push(first); attach(first, 0);
    const second = await sdk.joinById<TransportMetadata>(first.roomId, { protocolVersion }); rooms.push(second); attach(second, 1);
    await vi.waitFor(() => expect(!!owners[0] && !!owners[1]).toBe(true));
    timer = setInterval(() => {
      for (const index of [0, 1]) {
        const owner = owners[index], snapshot = latest[index];
        if (!owner || !rooms[index]?.connection.isOpen) continue;
        const reference = Math.max(owner.serverTimeMs, snapshot?.serverTimeMs ?? 0);
        if (performance.now() - reference >= 250) { drive[index] = 0; continue; }
        rooms[index]!.send('input', { protocolVersion, sequence: ++sequences[index]!, connectionGeneration: owner.connectionGeneration,
          runGeneration: snapshot?.runGeneration ?? owner.runGeneration, referenceTimeMs: reference, x: 0, z: drive[index]! });
      }
    }, 1000 / 30);
    await vi.waitFor(() => expect(latest[0]?.phase).toBe('running'));
    drive[0] = drive[1] = 1;
    await vi.waitFor(() => expect(latest[0]!.tick).toBeGreaterThan(245), { timeout: 6000 });
    expect(latest[0]!.players.every(({ position }) => position.z < 7 && position.z > 2)).toBe(true);
    drive[0] = drive[1] = -1;
    await vi.waitFor(() => expect(latest[0]!.players.every(({ position }) => position.z < 1)).toBe(true), { timeout: 6000 });
    drive[0] = drive[1] = 0;
    const token = first.reconnectionToken, generation = owners[0]!.connectionGeneration;
    first.connection.close();
    await vi.waitFor(() => expect(latest[1]?.phase).toBe('paused'));
    const frozen = latest[1]!;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(latest[1]).toMatchObject({ tick: frozen.tick, players: frozen.players, chain: frozen.chain });
    const resumed = await sdk.reconnect<TransportMetadata>(token); rooms[0] = resumed; owners[0] = undefined; attach(resumed, 0);
    await vi.waitFor(() => expect(owners[0]!.connectionGeneration).toBeGreaterThan(generation));
    await vi.waitFor(() => expect(latest[0]?.phase).toBe('running'));
    expect(latest[0]!.chain!.segments).toHaveLength(12);
    const run = latest[0]!.runGeneration;
    resumed.send('reset', { protocolVersion });
    await vi.waitFor(() => expect(latest.every((state) => state!.runGeneration === run + 1)).toBe(true));
    expect(latest[0]!.players[0]!.position.z).toBeCloseTo(0, 1);
    let common = 0;
    for (const [tick, state] of observed[0]!) if (observed[1]!.has(tick)) { expect(observed[1]!.get(tick)).toBe(state); common++; }
    expect(common).toBeGreaterThan(30);
    console.info('[M5 real socket lifecycle]', JSON.stringify({ commonAssemblyTicks: common }));
  } finally {
    clearInterval(timer);
    await Promise.all(rooms.map((room) => room.connection.isOpen ? room.leave() : Promise.resolve()));
  }
}, 20_000);
