import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TransportCallbacks } from './network-client';
import type { LobbyMessage, RoomPhase } from '@crossy/protocol';
import { protocolVersion } from '@crossy/protocol';
const stub = vi.hoisted(() => ({ callbacks: undefined as TransportCallbacks | undefined, send: vi.fn(), command: vi.fn(), connect: vi.fn(), privateMode: false, active: false }));
vi.mock('./network-client', () => ({ TransportTestClient: class {
  constructor(_endpoint: string, callbacks: TransportCallbacks, _course: unknown, privateMode: boolean) { stub.callbacks = callbacks; stub.privateMode = privateMode; }
  get active() { return stub.active; } get connected() { return stub.active; } get canRejoin() { return false; }
  sendInput = stub.send; lobbyAction = stub.command; connect = stub.connect;
  probe() {} reset() {} suspend() {} dispose() {} async leave() {}
} }));
vi.mock('./renderer', () => ({ GameRenderer: class {
  chain = { group: { visible: true }, setCount() {}, update() {} };
  players = new Map(['p1', 'p2'].map(id => [id, { reset() {}, update() {}, setDead() {}, setDanger() {}, setWater() {} }]));
  setNames() {} labels = { resetNames() {} };
  camera = { update() {} }; observeSnapshot() {} clearEffects() {} setScenario() {} async loadGoose() {} draw() {} dispose() {}
} }));
class Element extends EventTarget { value = ''; textContent = ''; disabled = false; hidden = false; focus() {} select() {} append() {} setAttribute() {} remove() {} }
let nodes: Map<string, Element>, windowEvents: EventTarget, tick: number, serverTime: number;
const node = (id: string) => nodes.get(id)!;
function snapshot(phase: RoomPhase, runGeneration: number) {
  stub.callbacks!.snapshot!({ protocolVersion, scenarioVersion: 1, runGeneration, phase, tick: ++tick,
    serverTimeMs: serverTime = Math.max(serverTime + 1, performance.now() + 1000), droppedSeconds: 0,
    players: ['p1', 'p2'].map(id => ({ id: id as 'p1' | 'p2', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, acknowledgedSequence: 0 })) });
}
function key() { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code: 'KeyW', repeat: false }); windowEvents.dispatchEvent(event); }
const lobby = (): LobbyMessage => ({ protocolVersion, capacity: 2, code: 'ABCDEFGH', epoch: 2, revision: 2, runGeneration: 0, stage: 'lobby', host: 'p1',
  players: ['p1', 'p2'].map(slot => ({ slot: slot as 'p1' | 'p2', connected: true, ready: false, restartRequested: false })) });
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  nodes = new Map(); nodes.set('group-size', new Element()); node('group-size').value = '2'; windowEvents = new EventTarget(); tick = 0; serverTime = 0;
  stub.active = false; stub.send.mockClear(); stub.command.mockClear(); stub.connect.mockReset().mockResolvedValue('ABCDEFGH');
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true,
    createElement: () => new Element(), getElementById: (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return node(id); } }));
  vi.stubGlobal('window', Object.assign(windowEvents, { setInterval, location: { pathname: '/play.html', protocol: 'http:', search: '', hash: '#ABCDEFGH', href: 'http://127.0.0.1:5173/play.html#ABCDEFGH' } }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  await import('./multiplayer-main');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('loads an invitation without autojoining, normalizes a typed code and uses private transport', async () => {
  expect(stub.privateMode).toBe(true); expect(node('room-id').value).toBe('ABCDEFGH'); expect(stub.connect).not.toHaveBeenCalled();
  node('room-id').value = 'abcd efgh'; node('join').dispatchEvent(new Event('click')); await Promise.resolve();
  expect(stub.connect).toHaveBeenCalledWith('ABCDEFGH', 2, 'road');
});
it('preserves server-owned lobby permissions and requires a fresh movement gesture after start', () => {
  stub.active = true; stub.callbacks!.welcome!({ protocolVersion, slot: 'p1', connectionGeneration: 1, runGeneration: 0, serverTimeMs: 1000 });
  snapshot('waiting', 0); const data = lobby(); stub.callbacks!.lobby!(data); stub.callbacks!.status('Connected', true);
  expect(node('reset').disabled).toBe(true); expect(node('start').disabled).toBe(true);
  node('ready').dispatchEvent(new Event('click')); expect(stub.command).toHaveBeenCalledWith('ready');
  data.players.forEach(p => { p.ready = true; }); stub.callbacks!.lobby!(data); expect(node('start').disabled).toBe(false);
  key(); vi.advanceTimersByTime(40); expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
  snapshot('running', 1); vi.advanceTimersByTime(40); expect(stub.send.mock.calls.at(-1)).toEqual([0, 0]);
  key(); vi.advanceTimersByTime(40); expect(stub.send.mock.calls.at(-1)).toEqual([0, 1]);
});
it('sends the creator-selected group size and adopts the immutable server capacity on join', async () => {
  node('group-size').value = '4'; node('create').dispatchEvent(new Event('click')); await Promise.resolve();
  expect(stub.connect).toHaveBeenCalledWith(undefined,4,'road');
  const data=lobby(); data.capacity=4; stub.callbacks!.lobby!(data);
  expect(node('group-size').value).toBe('4'); stub.active=true;stub.callbacks!.status('Connected',true);
  expect(node('group-size').disabled).toBe(true);
});

it('sends a reproduction seed only for Generated World and preserves default connection calls', async () => {
  document.getElementById('course')!;
  node('course').value = 'generated';
  document.getElementById('world-seed')!;
  node('world-seed').value = '42';
  node('create').dispatchEvent(new Event('click')); await Promise.resolve();
  expect(stub.connect).toHaveBeenCalledWith(undefined,2,'generated',42);
});
it('ignores repeated create clicks while connecting or already inside a room', async () => {
  let resolve!: (code:string)=>void; stub.connect.mockImplementation(()=>new Promise<string>(done=>{resolve=done;}));
  node('create').dispatchEvent(new Event('click'));node('create').dispatchEvent(new Event('click'));
  expect(stub.connect).toHaveBeenCalledTimes(1);stub.active=true;resolve('ABCDEFGH');await Promise.resolve();await Promise.resolve();
  node('create').dispatchEvent(new Event('click'));expect(stub.connect).toHaveBeenCalledTimes(1);
});
it('keeps invalid invite text available for correction without starting a connection',()=>{
  node('room-id').value='bad';node('join').dispatchEvent(new Event('click'));expect(stub.connect).not.toHaveBeenCalled();expect(node('room-id').value).toBe('bad');expect(node('result').textContent).toContain('eight-character');
});
