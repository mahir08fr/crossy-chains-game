import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import { TransportTestClient } from './network-client';
import { ControllerInput } from './controller-input';
import type { ControllerStatus, DisplayWelcome, LobbyMessage } from '@crossy/protocol';
import { unpackSnapshot } from '@crossy/protocol';
import { AuthoritativeSession } from '../../server/src/authoritative-session.js';
import { createServerRuntime } from '../../server/src/runtime.js';
import { readServerConfig } from '../../server/src/config.js';
vi.mock('@colyseus/sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@colyseus/sdk')>();
  return { ...actual, Client: class extends actual.Client {
    constructor(endpoint: string) { super(endpoint, { headers: { Origin: 'http://127.0.0.1:5173' } }); }
  } };
});
const runtime = createServerRuntime(readServerConfig({})); let endpoint: string;
beforeAll(async () => { endpoint = `http://127.0.0.1:${await runtime.start(0)}`; });
afterAll(async () => { await runtime.stop(); });
it.each([false, true])('real phone pump: legacy clock=%s, idle, simultaneous holds and lifecycle safety', async legacyClock => {
  // Expiry's immediate neutral reply can rearm before the next 20-Hz status.
  // Observe actual 60-Hz authority as well as the latched expiry health event.
  const authoritativePhases: string[] = [];
  const originalPhase = AuthoritativeSession.prototype.setPhase;
  const phaseSpy = vi.spyOn(AuthoritativeSession.prototype, 'setPhase').mockImplementation(function(this: AuthoritativeSession, next) {
    originalPhase.call(this, next); authoritativePhases.push(this.phase);
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  const sdk = new Client(endpoint, { headers: { Origin: 'http://127.0.0.1:5173' } });
  const display = await sdk.create('couch-game', { protocolVersion: 1, role: 'display', displaySecret: 'a'.repeat(32), capacity: 2 });
  display.reconnection.enabled = false;
  let owner: DisplayWelcome | undefined, lobby: LobbyMessage | undefined, run = 0, phase = 'waiting', ticks = 0;
  display.onMessage('display-welcome', m => owner = m); display.onMessage('lobby', m => lobby = m);
  display.onMessage('snapshot', m => { phase = m.phase; run = m.runGeneration; ticks = m.tick; });
  display.onMessage('snapshot-compact', m => { const s = unpackSnapshot(m)!; phase = s.phase; run = s.runGeneration; ticks = s.tick; });
  display.onMessage('rejected', () => undefined); display.onMessage('lobby-rejected', () => undefined); display.onMessage('room-closed', () => undefined);
  display.send('hello', { protocolVersion: 1 });
  const visible = [true, true];
  const health: import('@crossy/protocol').CouchHealth[] = [];
  const axes = [{ x: 0, z: 0 }, { x: 0, z: 0 }], states: (ControllerStatus | undefined)[] = [], expires: number[] = [], rejects: string[] = [], phases: string[] = [];
  const safetyTrace: { at: number; device: number; event: string; detail: object }[] = [];
  const trace = (device: number, event: string, detail: object) => { safetyTrace.push({at:performance.now(),device,event,detail}); if(safetyTrace.length>80)safetyTrace.shift(); };
  const clients: TransportTestClient[] = [], pumps: ControllerInput[] = [];
  const heartbeat = setInterval(() => display.send('display-heartbeat', { protocolVersion: 1, active: true }), 1000);
  const timer = setInterval(() => clients.forEach((c, i) => pumps[i]!.update(performance.now(), visible[i]!, c.connected, () => axes[i]!)), 1000 / 30);
  let probes = setInterval(() => clients.forEach(c => c.probe()), 2000);
  try {
    for (let i = 0; i < 2; i++) {
      const pump = new ControllerInput((x,z) => clients[i]!.sendInput(x,z), () => { axes[i] = { x: 0, z: 0 }; }, (event,detail)=>trace(i,event,detail)); pumps[i] = pump;
      clients[i] = new TransportTestClient(endpoint, {
        health: m => { if (i === 0) health.push(m); },
        status: () => undefined, state: () => undefined, result: () => undefined,
        welcome: () => pump.reset(), clock: (server, sent, got) => pump.clock(server, sent, got),
        control: m => { states[i] = m; phases.push(m.phase); pump.receive(m, performance.now()); },
        inputExpired: message => { trace(i,'expired',message); expires.push(i); axes[i] = { x: 0, z: 0 }; if (visible[i]) clients[i]!.sendInput(0,0); },
        rejected: reason => { rejects.push(reason); if (reason === 'requires-neutral') { axes[i] = { x: 0,z:0 }; clients[i]!.sendInput(0,0); } return true; },
      }, undefined, true, 'controller');
      await clients[i]!.connect(display.roomId);
    }
    await vi.waitFor(() => expect(clients.every(c => c.connected)).toBe(true));
    clients.forEach(c => c.lobbyAction('ready'));
    await vi.waitFor(() => expect(lobby?.players.every(p => p.ready)).toBe(true));
    display.send('display-heartbeat', { protocolVersion: 1, active: true });
    display.send('lobby', { protocolVersion: 1, action: 'start', connectionGeneration: owner!.connectionGeneration, runGeneration: run, lobbyEpoch: lobby!.epoch });
    await vi.waitFor(() => expect(phase).toBe('running')); phases.length = 0; rejects.length = 0; health.length = 0;
    await new Promise(r => setTimeout(r, 3500)); // idle, with normal 2-second probes
    clearInterval(probes); probes = setInterval(() => clients.forEach(c => c.probe()), 2000);
    const now = performance.now();
    if (legacyClock) Object.assign(pumps[0]!, { clockOffset: 500 }); // exact prior midpoint result
    else pumps[0]!.clock(now, now - 1000, now); // same asymmetrically queued probe
    axes[0] = { x: -.15, z: 0 }; axes[1] = { x: -.15, z: 0 };
    await new Promise(r => setTimeout(r, 4500)); // same-direction bank movement, both held
    if (legacyClock) {
      expect(expires).toContain(0); expect(authoritativePhases).toContain('paused');
      expect(health.some(h => h.blockers.some(b => b.device === 'p1' && b.reason === 'input-expired'))).toBe(true);
      expect(health.every(h => h.display.connected && h.display.active)).toBe(true);
    } else {
      expect(expires).toEqual([]); expect(rejects).toEqual([]); expect(phases.every(p => p === 'running')).toBe(true); expect(ticks).toBeGreaterThan(350);
      // Hidden/locked phone: keep healthy peer/display alive, stop just P1.
      visible[0] = false;
      await vi.waitFor(() => expect(expires).toContain(0));
      await vi.waitFor(() => expect(phase).toBe('paused'));
      expect(expires).not.toContain(1);
      expect(health.some(h => h.blockers.some(b => b.device === 'p1' && b.reason === 'input-expired'))).toBe(true);
      visible[0] = true;
      await vi.waitFor(() => expect(phase).toBe('running'));
      expect(axes).toEqual([{ x: 0, z: 0 }, { x: 0, z: 0 }]); // release/new touch required
    }
    expect(states.every(s => s?.displayActive)).toBe(true);
  } catch(error) { console.error('PHONE_LIFECYCLE_DIAGNOSTIC',JSON.stringify({legacyClock,expires,rejects,phase,ticks,safetyTrace,health:health.slice(-8)})); throw error; } finally { clearInterval(timer); clearInterval(probes); clearInterval(heartbeat); await display.leave(); for (const c of clients) await c.leave(); vi.unstubAllGlobals(); phaseSpy.mockRestore(); }
}, 18_000);
