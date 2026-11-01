import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportCallbacks } from './network-client';
import type { RoomPhase, SnapshotMessage } from '@crossy/protocol';
import { protocolVersion } from '@crossy/protocol';
const stub = vi.hoisted(() => ({ callbacks: undefined as TransportCallbacks | undefined, send: vi.fn(), connected: true }));
vi.mock('./network-client', () => ({ TransportTestClient: class {
  constructor(_endpoint: string, callbacks: TransportCallbacks) { stub.callbacks = callbacks; }
  get connected() { return stub.connected; }
  sendInput = stub.send;
  probe() {} reset() {} dispose() {} async leave() {}
} }));
vi.mock('./renderer', () => ({ GameRenderer: class {
  chain = { group: { visible: true }, setCount() {}, update() {} };
  players = new Map(['p1', 'p2'].map((id) => [id, { reset: vi.fn(), update: vi.fn() }]));
  camera = { update: vi.fn() };
  labels = { resetNames: vi.fn() }; setNames() {}
  observeSnapshot() {} clearEffects() {} setScenario() {} async loadGoose() {} draw() {} dispose() {}
} }));
let windowEvents: EventTarget;
let documentEvents: EventTarget & { hidden: boolean };
let serverTick: number;
let lastServerTime: number;
let diagnosticEvents: Record<string, unknown>[];
function snapshot(phase: RoomPhase = 'running', runGeneration = 0): void {
  const message: SnapshotMessage = { protocolVersion, scenarioVersion: 1, runGeneration,
    serverTimeMs: Math.max(1000 + performance.now(), lastServerTime + 0.001), tick: ++serverTick, phase, droppedSeconds: 0,
    players: ['p1', 'p2'].map((id) => ({ id: id as 'p1' | 'p2', position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, grounded: true, acknowledgedSequence: 1 })),
  };
  lastServerTime = message.serverTimeMs;
  stub.callbacks!.snapshot!(message);
}
function key(code = 'KeyW', type = 'keydown', repeat = false): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat, ctrlKey: false, altKey: false, metaKey: false });
  windowEvents.dispatchEvent(event);
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  diagnosticEvents = [];
  vi.spyOn(console, 'info').mockImplementation((_label: unknown, event: Record<string, unknown>) => diagnosticEvents.push(event));
  serverTick = 0; lastServerTime = 0; stub.send.mockClear(); stub.connected = true;
  windowEvents = new EventTarget();
  const elements = new Map<string, EventTarget & { value: string; textContent: string; disabled: boolean; focus: () => void }>();
  documentEvents = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true,
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, Object.assign(new EventTarget(), { value: '', textContent: '', disabled: false, focus: () => undefined }));
      return elements.get(id);
    },
  });
  vi.stubGlobal('window', Object.assign(windowEvents, { location: { protocol: 'http:', search: '?inputDiagnostics=1' }, setInterval }));
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  await import('./multiplayer-main');
  stub.callbacks!.welcome!({ protocolVersion, slot: 'p1', connectionGeneration: 1, runGeneration: 0, serverTimeMs: 1000 });
  snapshot(); vi.advanceTimersByTime(1);
});
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('real multiplayer UI input lifecycle with simulated browser events', () => {
  it('keeps W held through a healthy focused stream without relying on repeat events', () => {
    key();
    for (let i = 0; i < 120; i++) { vi.advanceTimersByTime(50); snapshot(); }
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
    expect(stub.send.mock.calls.length).toBeGreaterThan(150);
  });
  it('does not erase a held key merely because one obsolete packet was rejected', () => {
    key(); stub.callbacks!.rejected!('stale-input');
    vi.advanceTimersByTime(50); snapshot();
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
  });
  it('identifies obsolete packets and peer pauses without reporting client key clearing', () => {
    key(); stub.callbacks!.rejected!('stale-input');
    vi.advanceTimersByTime(1); snapshot('paused');
    expect(diagnosticEvents).toContainEqual(expect.objectContaining({ event: 'packet-rejected', code: 'stale-input', focused: true, hidden: false }));
    expect(diagnosticEvents).toContainEqual(expect.objectContaining({ event: 'server-phase', to: 'paused' }));
    expect(diagnosticEvents.some((event) => event.event === 'client-input-clear')).toBe(false);
    stub.callbacks!.inputExpired!({ protocolVersion, slot: 'p1', connectionGeneration: 1,
      runGeneration: 0, serverTimeMs: 1002, sequence: 3, silenceMs: 250 });
    expect(diagnosticEvents).toContainEqual(expect.objectContaining({ event: 'server-input-expired', silenceMs: 250 }));
    expect(diagnosticEvents).toContainEqual(expect.objectContaining({ event: 'client-input-clear', reason: 'server-expiry' }));
  });
  it('clears only owned server expiry and cannot revive W through repeat events', () => {
    key();
    stub.callbacks!.inputExpired!({ protocolVersion, slot: 'p1', connectionGeneration: 1,
      runGeneration: 0, serverTimeMs: 1001, sequence: 3, silenceMs: 250 });
    key('KeyW', 'keydown', true); vi.advanceTimersByTime(50); snapshot();
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    key('KeyW', 'keyup'); key();
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
  });
  it('preserves neutral/fresh-gesture safety on real focus and visibility changes', () => {
    key(); windowEvents.dispatchEvent(new Event('blur'));
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    windowEvents.dispatchEvent(new Event('focus')); key('KeyW', 'keydown', true);
    vi.advanceTimersByTime(50); snapshot();
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    key(); expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
    documentEvents.hidden = true; documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    documentEvents.hidden = false; documentEvents.dispatchEvent(new Event('visibilitychange'));
    key('KeyW', 'keydown', true); vi.advanceTimersByTime(50); snapshot();
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
  });
  it('clears stale received state, genuine scheduling stalls, resets and disconnections', () => {
    key(); vi.advanceTimersByTime(300); snapshot(); key('KeyW', 'keydown', true);
    vi.advanceTimersByTime(40);
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    key(); expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
    // Skip timer execution to simulate a suspended browser main thread.
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    key('KeyW', 'keydown', true); snapshot(); vi.advanceTimersByTime(40);
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    key(); expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
    snapshot('running', 1); vi.advanceTimersByTime(40);
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    key(); stub.connected = false; stub.callbacks!.status('Disconnected', false);
    const calls = stub.send.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(stub.send).toHaveBeenCalledTimes(calls);
  });
  it('sends neutral during a peer pause and resumes the healthy held gesture afterward', () => {
    key(); vi.advanceTimersByTime(10); snapshot('paused'); vi.advanceTimersByTime(40);
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
    snapshot('running'); vi.advanceTimersByTime(40);
    expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
  });
});
