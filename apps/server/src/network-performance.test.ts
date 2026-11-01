import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { relay } from './tcp-relay.test-helper.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { isSnapshotMessage, protocolVersion, transportRoomName } from '@crossy/protocol';
import type { ChainCourse, SnapshotMessage, TransportMetadata, WelcomeMessage, RejectionMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
import { AuthoritativeSession } from './authoritative-session.js';

const origin = 'http://127.0.0.1:5173';
const runtime = createServerRuntime(readServerConfig({}));
let serverPort: number;
beforeAll(async () => { serverPort = await runtime.start(0); });
afterAll(async () => { await runtime.stop(); });
const profiles: { name: string; delay: number; jitter: number; holdEvery: number; interruption?: boolean; chainCourse?: ChainCourse; high?: boolean; schedulingStallMs?: number }[] = [
  { name: '50 ms TCP stream', delay: 25, jitter: 0, holdEvery: 0 },
  { name: '100 ms ±20 TCP stream', delay: 50, jitter: 10, holdEvery: 0 },
  { name: '150 ms ±30 +HOL TCP stream', delay: 75, jitter: 15, holdEvery: 40 },
  { name: '2-second TCP stream stall', delay: 50, jitter: 10, holdEvery: 0, interruption: true },
];
profiles.push(...profiles.map((profile) => ({ ...profile, name: `Chain ${profile.name}`, chainCourse: 'two-posts' as const })),
  { name: 'Chain loopback TCP', delay: 0, jitter: 0, holdEvery: 0, chainCourse: 'two-posts' },
  { name: 'Chain 250 ms ±50 +HOL TCP', delay: 125, jitter: 25, holdEvery: 33, chainCourse: 'two-posts', high: true },
  // The client/server/relay share a process. A descheduled test host is a real
  // input-safety interruption, not an extra 350 ms of ordinary network latency.
  { name: '100 ms TCP +350 ms host stall', delay: 50, jitter: 10, holdEvery: 0, schedulingStallMs: 350 },
  { name: 'Chain 50 ms TCP +350 ms host stall', delay: 25, jitter: 0, holdEvery: 0, chainCourse: 'two-posts', schedulingStallMs: 350 });
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;

describe('actual TCP-stream impairment', () => {
  it.each(profiles)('$name preserves synchronization, input safety and server stability', async (profile) => {
    const proxy = await relay(serverPort, profile);
    const sdk = new Client(proxy.endpoint, { headers: { Origin: origin } });
    const rooms: Room<unknown, TransportMetadata>[] = [];
    const pending = new Set<ReturnType<typeof setInterval>>();
    const eventLoop = monitorEventLoopDelay({ resolution: 10 }); eventLoop.enable();
    const cpuStart = process.cpuUsage(), memoryStart = process.memoryUsage().heapUsed;
    const snapshots = [new Map<string, string>(), new Map<string, string>()];
    const latestFrames: (SnapshotMessage | undefined)[] = [undefined, undefined];
    const rtts: number[] = [], gaps: number[] = [], ages: number[] = [];
    let peakSnapshotBytes = 0;
    let expiries = 0, rejections = 0, firstMovement = Infinity;
    const rejectionCodes: Record<string, number> = {};
    const expiryTrace: { index: number; afterGestureMs: number | null; silenceMs: number }[] = [];
    let senderAt: number | undefined, maxSenderGapMs = 0;
    let movementAt = Infinity, recoveryAt = Infinity, recoveredMovement = Infinity;
    const gestureSequences = [Infinity, Infinity], recoverySequences = [Infinity, Infinity];
    const driving = [false, false], expiredAfterGesture = new Set<number>();
    const advance = AuthoritativeSession.prototype.advance;
    const faultTrace = vi.spyOn(AuthoritativeSession.prototype, 'advance').mockImplementation(function (this: AuthoritativeSession, elapsedSeconds: number) {
      const previous = this.phase;
      advance.call(this, elapsedSeconds);
      if (previous !== 'fault' && this.phase === 'fault') console.error('[TCP physics fault]', JSON.stringify({ profile: profile.name, fault: this.simulation.fault, players: this.simulation.states(), metrics: this.simulation.chainMetricsAll() }));
    });
    try {
      const first = await sdk.create<TransportMetadata>(transportRoomName, { protocolVersion, ...(profile.chainCourse ? { chainCourse: profile.chainCourse } : {}) }); rooms.push(first);
      first.reconnection.enabled = false;
      first.onMessage('snapshot', () => undefined); first.onMessage('input-expired', () => undefined);
      const second = await sdk.joinById<TransportMetadata>(first.roomId, { protocolVersion }); rooms.push(second);
      const sequences = [0, 0], references = [0, 0];
      const welcome: (WelcomeMessage | undefined)[] = [];
      const sentProbes = new Map<string, number>();
      for (const [index, room] of rooms.entries()) {
        room.reconnection.enabled = false; room.reconnection.maxEnqueuedMessages = 0;
        let lastSnapshotAt: number | undefined;
        room.onMessage('input-expired', (message: { silenceMs: number }) => {
          expiryTrace.push({ index, afterGestureMs: Number.isFinite(movementAt) ? performance.now() - movementAt : null, silenceMs: message.silenceMs }); expiries++; driving[index] = false; if (performance.now() >= movementAt) expiredAfterGesture.add(index); });
        room.onMessage('rejected', (message: RejectionMessage) => { rejections++; rejectionCodes[message.code] = (rejectionCodes[message.code] ?? 0) + 1; });
        room.onMessage('welcome', (message: WelcomeMessage) => { welcome[index] = message; references[index] = message.serverTimeMs; });
        room.onMessage('snapshot', (message: SnapshotMessage) => {
          const now = performance.now(); references[index] = message.serverTimeMs; latestFrames[index] = message;
          if (lastSnapshotAt !== undefined) gaps.push(now - lastSnapshotAt); lastSnapshotAt = now;
          expect(isSnapshotMessage(message)).toBe(true); expect(message.phase).not.toBe('fault');
          if (profile.chainCourse) expect(message.chain?.segments).toHaveLength(12);
          ages.push(now - message.serverTimeMs); peakSnapshotBytes = Math.max(peakSnapshotBytes, JSON.stringify(message).length);
          snapshots[index]!.set(`${message.tick}:${message.serverTimeMs}`, JSON.stringify({ players: message.players, ...(message.chain ? { chain: message.chain } : {}) }));
          // A pre-gesture moving frame must not record -Infinity and mask a failure.
          if (index === 0 && message.players[0]!.position.z > (profile.chainCourse ? .02 : -4.999)) {
            if (Number.isFinite(movementAt) && message.players[0]!.acknowledgedSequence >= gestureSequences[0]!) firstMovement = Math.min(firstMovement, now - movementAt);
            if (Number.isFinite(recoveryAt) && message.players[0]!.acknowledgedSequence >= recoverySequences[0]!) recoveredMovement = Math.min(recoveredMovement, now - recoveryAt);
          }
        });
        room.onMessage('probe-reply', (message: { sequence: number }) => {
          const sent = sentProbes.get(`${index}:${message.sequence}`); if (sent !== undefined) rtts.push(performance.now() - sent);
        });
        room.send('hello', { protocolVersion });
      }
      await vi.waitFor(() => expect(!!welcome[0] && !!welcome[1]).toBe(true));
      const started = performance.now();
      const sendInput = (index: number) => {
        if (performance.now() - references[index]! >= 250) { driving[index] = false; return; } // Same-process server clock; never send against stale state.
        const owned = welcome[index]!;
        rooms[index]!.send('input', { protocolVersion, sequence: ++sequences[index]!, connectionGeneration: owned.connectionGeneration,
          runGeneration: owned.runGeneration, referenceTimeMs: references[index]!, x: 0, z: driving[index] ? 1 : 0 });
      };
      const sender = setInterval(() => {
        const now = performance.now(); if (senderAt !== undefined) maxSenderGapMs = Math.max(maxSenderGapMs, now - senderAt); senderAt = now;
        for (const index of [0, 1]) sendInput(index); }, 1000 / 30);
      pending.add(sender);
      if (!profile.high) {
        await vi.waitFor(() => expect(first.state.phase).toBe('running'));
        // A delayed schema phase patch does not prove either current lease is
        // fresh. Renew neutral and observe both authoritative acknowledgments
        // before measuring this one gesture. Expiry still clears it; no replay.
        await vi.waitFor(() => { for (const index of [0,1]) expect(performance.now()-references[index]!).toBeLessThan(200); });
        const neutralSequences=sequences.map(sequence=>sequence+1);
        sendInput(0);sendInput(1);
        await vi.waitFor(() => { for (const index of [0,1]) {
          const frame=latestFrames[index];expect(frame?.phase).toBe('running');
          expect(frame?.players[index]?.acknowledgedSequence).toBeGreaterThanOrEqual(neutralSequences[index]!);
          expect(performance.now()-frame!.serverTimeMs).toBeLessThan(200);
        } });
      }
      gestureSequences[0] = sequences[0]! + 1; gestureSequences[1] = sequences[1]! + 1;
      movementAt = performance.now(); driving[0] = true; if (profile.chainCourse) driving[1] = true; sendInput(0); if (profile.chainCourse) sendInput(1); // Match the real keydown edge, not just the next heartbeat.
      if (profile.schedulingStallMs) {
        // Deliberate test-only main-thread descheduling, after send and before the
        // relay can deliver the gesture. Both server leases must expire safely.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, profile.schedulingStallMs);
      }
      for (let sequence = 1; sequence <= 10; sequence++) {
        if (profile.interruption && sequence === 3) proxy.hold(2000);
        for (const [index, room] of rooms.entries()) {
          sentProbes.set(`${index}:${sequence}`, performance.now());
          room.send('probe', { protocolVersion, sequence, clientTimeMs: performance.now() });
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      let common = 0; const commonTicks = new Set<string>();
      for (const [tick, state] of snapshots[0]!) if (snapshots[1]!.has(tick)) { expect(snapshots[1]!.get(tick)).toBe(state); common++; commonTicks.add(tick.split(':')[0]!); }
      const elapsed = performance.now() - started, usage = process.cpuUsage(cpuStart), memory = process.memoryUsage().heapUsed;
      console.info(profile.chainCourse ? '[M5 TCP performance]' : '[M4 TCP performance]', JSON.stringify({ profile: profile.name, rttMedian: +percentile(rtts, .5).toFixed(1),
        rttP95: +percentile(rtts, .95).toFixed(1), snapshotGapP95: +percentile(gaps, .95).toFixed(1), snapshotAgeP95: +percentile(ages, .95).toFixed(1), peakSnapshotBytes,
        firstSnapshotMovementMs: Number.isFinite(firstMovement) ? +firstMovement.toFixed(1) : null, expiryEvents: expiries, rejections, commonTicks: commonTicks.size, commonSnapshots: common,
        tcpKiBPerSec: +(proxy.metrics().bytes / 1024 / (elapsed / 1000)).toFixed(2), holds: proxy.metrics().holds,
        maxSenderGapMs: +maxSenderGapMs.toFixed(1), maxDeliveryLatenessMs: +proxy.metrics().maxDeliveryLatenessMs.toFixed(1), rejectionCodes, expiryTrace,
        processCpuMs: +((usage.user + usage.system) / 1000).toFixed(1), heapDeltaMiB: +((memory - memoryStart) / 1024 ** 2).toFixed(2),
        eventLoopP95Ms: +(eventLoop.percentile(95) / 1e6).toFixed(2), eventLoopMaxMs: +(eventLoop.max / 1e6).toFixed(2) }));
      expect(rtts.length).toBeGreaterThan(10);
      if (!profile.high && !profile.schedulingStallMs) { await vi.waitFor(() => expect(first.state.phase).toBe('running')); expect(firstMovement).toBeLessThan(400); }
      if (profile.interruption) { expect(expiries).toBe(2); expect(driving).toEqual([false, false]); }
      for (const index of expiredAfterGesture) expect(first.state.players.get(index === 0 ? 'p1' : 'p2')!.z).toBe(0); // Only expired owners lose their gesture.
      expect(common).toBeGreaterThan(10);
      expect([...snapshots[0]!.values()].every((value) => !value.includes('null'))).toBe(true);
      if (profile.schedulingStallMs) {
        expect(firstMovement).toBe(Infinity);
        // The injected stall must expire both owners. Later neutral heartbeats
        // may also expire under host scheduling; those valid safety events are
        // not duplicate notices for the injected interruption.
        expect(expiryTrace.slice(0, 2).map(event => event.index).sort()).toEqual([0, 1]);
        for (const event of expiryTrace) expect(event.silenceMs).toBeGreaterThanOrEqual(250);
        expect(driving).toEqual([false, false]);
        expect(maxSenderGapMs).toBeGreaterThanOrEqual(250);
        await vi.waitFor(() => expect(first.state.phase).toBe('running'));
        recoverySequences[0] = sequences[0]! + 1; recoverySequences[1] = sequences[1]! + 1;
        recoveryAt = performance.now(); driving[0] = true; if (profile.chainCourse) driving[1] = true;
        sendInput(0); if (profile.chainCourse) sendInput(1);
        await vi.waitFor(() => expect(recoveredMovement).toBeLessThan(400));
        console.info('[TCP fresh gesture after host stall]', JSON.stringify({ profile: profile.name, recoveredMovementMs: +recoveredMovement.toFixed(1) }));
      }
    } finally {
      faultTrace.mockRestore();
      for (const timer of pending) clearInterval(timer); eventLoop.disable();
      await Promise.all(rooms.map((room) => room.connection.isOpen ? room.leave() : Promise.resolve()));
      await proxy.stop();
    }
  }, 15_000);
});
