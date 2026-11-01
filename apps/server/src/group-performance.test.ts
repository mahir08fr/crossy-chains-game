import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { isSnapshotMessage, playerSlots, privateRoomName, protocolVersion } from '@crossy/protocol';
import type { LobbyMessage, SnapshotMessage, TransportMetadata, WelcomeMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
import { relay } from './tcp-relay.test-helper.js';
import { AuthoritativeSession } from './authoritative-session.js';
const runtime = createServerRuntime(readServerConfig({})); let port: number;
beforeAll(async () => { port = await runtime.start(0); }); afterAll(() => runtime.stop());
const percentile = (values: number[], fraction: number) => [...values].sort((a,b) => a-b)[Math.floor((values.length-1)*fraction)] ?? 0;
for (const capacity of [2,3,4] as const) {
  it(`${capacity}-player simulation cost and repeated reset resources`, () => {
    const heapStart = process.memoryUsage().heapUsed;
    const s = new AuthoritativeSession('road', capacity), costs: number[] = [];
    let excess = 0;
    try {
      for (let cycle = 0; cycle < 5; cycle++) {
        s.setPhase('running');
        for (let tick = 0; tick < 240; tick++) {
          const start = performance.now(); s.advance(1/60); if (tick >= 120) costs.push(performance.now()-start);
          excess = Math.max(excess, ...s.simulation.chainMetricsAll().map(m => m.excessRatio));
        }
        expect(s.phase).toBe('running');
        expect(s.simulation.world.bodies.len()).toBe(capacity + 12*(capacity-1));
        expect(s.simulation.world.impulseJoints.len()).toBe(13*(capacity-1)); s.reset();
      }
      console.info('M8 simulation', JSON.stringify({ capacity, samples: costs.length, p50Ms: percentile(costs,.5), p95Ms: percentile(costs,.95), maxMs: Math.max(...costs), peakExcess: excess,
        heapDeltaMiB: (process.memoryUsage().heapUsed - heapStart) / 1024 / 1024, snapshotJSONBytes: JSON.stringify(s.snapshot(0)).length, bodies: s.simulation.world.bodies.len(), colliders: s.simulation.world.colliders.len(), joints: s.simulation.world.impulseJoints.len() }));
    } finally { s.dispose(); }
  }, 15_000);
  for (const delayed of [false, true]) {
    it(`${capacity}-player TCP ${delayed ? '100 ms ±20 jitter' : 'loopback'} agrees on complete snapshots and bandwidth`, async () => {
      const proxy = await relay(port, { delay: delayed ? 50 : 0, jitter: delayed ? 10 : 0, holdEvery: 0 });
      const sdk = new Client(proxy.endpoint, { headers: { Origin: 'http://127.0.0.1:5173' } });
      const rooms: Room<unknown,TransportMetadata>[] = [], owners: (WelcomeMessage | undefined)[] = [], states: (SnapshotMessage | undefined)[] = [], lobbies: (LobbyMessage | undefined)[] = [];
      const seen = Array.from({ length: capacity }, () => new Map<string,string>()), sequences = Array.from({ length: capacity }, () => 0);
      const lobbyRejects: unknown[] = [], readySent: unknown[] = [];
      const rtts: number[] = [], ages: number[] = []; let expiries = 0, maxPayload = 0;
      const timers: ReturnType<typeof setInterval>[] = [];
      const attach = (room: Room<unknown,TransportMetadata>, i: number) => {
        rooms[i] = room; room.reconnection.enabled = false;
        room.onMessage('welcome', (m: WelcomeMessage) => { owners[i] = m; });
        room.onMessage('lobby', (m: LobbyMessage) => { lobbies[i] = m; });
        room.onMessage('snapshot', (m: SnapshotMessage) => {
          expect(isSnapshotMessage(m)).toBe(true); states[i] = m;
          const json = JSON.stringify(m); seen[i]!.set(`${m.runGeneration}:${m.tick}:${m.serverTimeMs}`, json); maxPayload = Math.max(maxPayload, json.length);
          ages.push(Math.max(0,performance.now()-m.serverTimeMs));
        });
        room.onMessage('probe-reply', m => rtts.push(performance.now()-m.clientTimeMs));
        room.onMessage('input-expired', () => { expiries++; }); room.onMessage('rejected', () => undefined); room.onMessage('lobby-rejected', message => lobbyRejects.push({ i, message, at: performance.now() }));
        room.send('hello', { protocolVersion });
        timers.push(setInterval(() => {
          const owner = owners[i], state = states[i]; if (!owner || !state || performance.now() - state.serverTimeMs >= 250) return;
          room.send('input', { protocolVersion, sequence: ++sequences[i]!, connectionGeneration: owner.connectionGeneration, runGeneration: state.runGeneration,
            referenceTimeMs: Math.max(owner.serverTimeMs,state.serverTimeMs), x: 0, z: 0 });
        }, 1000/30));
        timers.push(setInterval(() => room.send('probe', { protocolVersion, sequence: sequences[i]!, clientTimeMs: performance.now() }), 250));
      };
      const command = (i: number, action: 'ready' | 'start') => rooms[i]!.send('lobby', { protocolVersion, action, connectionGeneration: owners[i]!.connectionGeneration,
        runGeneration: states[i]!.runGeneration, lobbyEpoch: lobbies[i]!.epoch });
      try {
        const first = await sdk.create<TransportMetadata>(privateRoomName,{ protocolVersion, capacity }); attach(first,0);
        for (let i=1;i<capacity;i++) attach(await sdk.joinById<TransportMetadata>(first.roomId,{ protocolVersion }),i);
        await vi.waitFor(() => expect(playerSlots.slice(0,capacity).every((slot,i) => owners[i]?.slot === slot && states[i] && lobbies[i]?.players.length === capacity)).toBe(true), { timeout: 4000 });
        readySent.push(...rooms.map((_,i)=>({i,owner:owners[i],run:states[i]?.runGeneration,lobby:lobbies[i]})));
        rooms.forEach((_,i) => command(i,'ready'));
        await vi.waitFor(() => expect(lobbies[0]!.players.every(p=>p.ready)).toBe(true)); command(0,'start');
        await vi.waitFor(() => expect(rooms.every((_,i)=>states[i]?.phase === 'running')).toBe(true), { timeout: 4000 });
        const bytes = proxy.metrics().bytes, start = performance.now();
        await new Promise(r=>setTimeout(r,2500));
        const seconds = (performance.now()-start)/1000, kibPerSecond = (proxy.metrics().bytes-bytes)/seconds/1024;
        const common = [...seen[0]!].filter(([key])=>seen.every(map=>map.has(key)));
        expect(common.length).toBeGreaterThan(25);
        for (const [key,json] of common) for (const map of seen) expect(map.get(key)).toBe(json);
        expect(states.every(s=>s?.phase !== 'fault')).toBe(true);
        console.info('M8 TCP',JSON.stringify({ capacity, profile: delayed ? '100±20' : 'loopback', seconds, roomKiBPerSecond:kibPerSecond, perDisplayKiBPerSecond:kibPerSecond/capacity,
          rttMedianMs:percentile(rtts,.5),rttP95Ms:percentile(rtts,.95),snapshotAgeP95Ms:percentile(ages,.95),expiries,commonSnapshots:common.length,maxJSONBytes:maxPayload }));
        if (capacity === 4 && delayed) {
          const before = expiries; proxy.hold(2000); await new Promise(r => setTimeout(r, 2800));
          expect(expiries - before).toBeGreaterThanOrEqual(4);
          await vi.waitFor(() => expect(states.every(s => s?.phase === 'running')).toBe(true), { timeout: 3000 });
          expect(states.every(s => s!.players.every(p => Math.abs(p.position.z + 2) < .2))).toBe(true);
          console.info('M8 four-player stall', JSON.stringify({ durationMs: 2000, expiries: expiries - before, resumedNeutrally: true }));
        }
      } catch (error) {
        console.error('GROUP_START_DIAGNOSTIC', JSON.stringify({ capacity, delayed, readySent, lobbyRejects, lobbies, states: states.map(s=>({phase:s?.phase,run:s?.runGeneration,tick:s?.tick})), relay:proxy.metrics() }));
        throw error;
      } finally { timers.forEach(clearInterval); await Promise.all(rooms.map(r=>r.connection.isOpen?r.leave():Promise.resolve())); await proxy.stop(); }
    }, 15_000);
  }
}
