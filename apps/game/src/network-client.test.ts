import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { protocolVersion } from '@crossy/protocol';
import { TransportTestClient } from './network-client';
const stub = vi.hoisted(() => ({ room: undefined as unknown, reconnect: vi.fn() }));
vi.mock('@colyseus/sdk', () => ({ Client: class {
  async create() { return stub.room; }
  async joinById() { return stub.room; }
  reconnect(token: string) { return stub.reconnect(token); }
} }));
function room(id = 'local-test') {
  const handlers = new Map<string, (value: unknown) => void>();
  let onLeave: (code: number) => void = () => undefined;
  return { roomId: id, reconnectionToken: `${id}:private-token`, connection: { close: vi.fn(() => onLeave(1006)) }, reconnection: { enabled: true, maxEnqueuedMessages: 100 }, send: vi.fn(),
    onMessage: (type: string, handler: (value: unknown) => void) => { handlers.set(type, handler); },
    onStateChange: vi.fn(), onError: vi.fn(), onLeave: (handler: (code: number) => void) => { onLeave = handler; },
    leave: vi.fn(async () => { onLeave(4000); }), emit: (type: string, value: unknown) => handlers.get(type)?.(value), drop: () => onLeave(1006),
  };
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  stub.reconnect.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const welcome = { protocolVersion, slot: 'p2', connectionGeneration: 3, runGeneration: 0, serverTimeMs: 100 };
const snapshot = (runGeneration = 0) => ({ protocolVersion, scenarioVersion: 1, runGeneration, tick: 0,
  serverTimeMs: 110 + runGeneration, phase: 'paused', droppedSeconds: 0,
  players: ['p1', 'p2'].map((id) => ({ id, position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, acknowledgedSequence: 0 })),
});
function client() {
  const callbacks = { status: vi.fn(), state: vi.fn(), result: vi.fn(), snapshot: vi.fn() };
  return { client: new TransportTestClient('http://127.0.0.1:2567', callbacks), callbacks };
}
describe('room client lifecycle and reset boundary', () => {
  it('bounds an unacknowledged leave without retaining input, credentials or affecting a new room', async () => {
    vi.useFakeTimers();
    const first = room('first'); stub.room = first;
    let acknowledge!: () => void;
    first.leave.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const { client: transport } = client(); await transport.connect(); first.emit('welcome', { ...welcome });
    let finished = false; const leaving = transport.leave().then(() => { finished = true; });
    expect(transport.active).toBe(false); expect(transport.canRejoin).toBe(false);
    const sent = first.send.mock.calls.length; transport.sendInput(1, 0); expect(first.send).toHaveBeenCalledTimes(sent);
    const next = room('next'); stub.room = next; await transport.connect(); next.emit('welcome', { ...welcome, connectionGeneration: 4 });
    await vi.advanceTimersByTimeAsync(2999); expect(finished).toBe(false); expect(first.connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await leaving;
    expect(first.connection.close).toHaveBeenCalledTimes(1); expect(transport.connected).toBe(true);
    acknowledge(); await Promise.resolve(); expect(transport.connected).toBe(true);
    expect(stub.reconnect).not.toHaveBeenCalled(); await transport.leave();
  });
  it('closes a cancelled late admission even when its consented leave never acknowledges', async () => {
    vi.useFakeTimers();
    let admit!: (value: ReturnType<typeof room>) => void;
    stub.room = new Promise(resolve => { admit = resolve; });
    const { client: transport } = client(); const connecting = transport.connect();
    const rejected = expect(connecting).rejects.toThrow('Connection cancelled');
    await transport.leave();
    const late = room(); late.leave.mockImplementation(() => new Promise<void>(() => undefined)); admit(late);
    await vi.advanceTimersByTimeAsync(3000); await rejected;
    expect(late.connection.close).toHaveBeenCalledTimes(1); expect(transport.active).toBe(false); expect(transport.canRejoin).toBe(false);
    expect(late.reconnection).toEqual({ enabled: false, maxEnqueuedMessages: 0 });
  });
  it('recovers repeated drops with fresh generations, without replaying offline input or old callbacks', async () => {
    vi.useFakeTimers();
    const first = room(); stub.room = first;
    const { client: transport, callbacks } = client();
    await transport.connect(); first.emit('welcome', { ...welcome });
    first.drop(); expect(transport.connected).toBe(false); expect(transport.active).toBe(true);
    transport.sendInput(1, 1);
    const next = room(); stub.reconnect.mockResolvedValueOnce(next);
    await vi.advanceTimersByTimeAsync(250);
    expect(stub.reconnect).toHaveBeenCalledWith(first.reconnectionToken);
    first.emit('snapshot', snapshot()); expect(callbacks.snapshot).not.toHaveBeenCalled();
    transport.sendInput(1, 0); expect(next.send).toHaveBeenCalledTimes(1); // hello only
    next.emit('welcome', { ...welcome, connectionGeneration: 4 }); transport.sendInput(0, 0);
    expect(next.send.mock.calls.at(-1)?.[1]).toMatchObject({ sequence: 1, connectionGeneration: 4, x: 0, z: 0 });
    next.drop(); const third = room(); stub.reconnect.mockResolvedValueOnce(third);
    await vi.advanceTimersByTimeAsync(250); third.emit('welcome', { ...welcome, connectionGeneration: 5 });
    expect(transport.connected).toBe(true); await transport.leave();
    expect(transport.canRejoin).toBe(false);
  });
  it('cancels retries on leave, bounds prolonged failures and discards an in-flight late success', async () => {
    vi.useFakeTimers();
    const first = room(); stub.room = first;
    const { client: transport } = client(); await transport.connect(); first.emit('welcome', { ...welcome });
    first.drop(); await transport.leave(); await vi.advanceTimersByTimeAsync(1000);
    expect(stub.reconnect).not.toHaveBeenCalled();
    await transport.connect(); first.emit('welcome', { ...welcome }); first.drop();
    stub.reconnect.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.active).toBe(false); expect(transport.canRejoin).toBe(false);
    const calls = stub.reconnect.mock.calls.length; await vi.advanceTimersByTimeAsync(5000);
    expect(stub.reconnect).toHaveBeenCalledTimes(calls);
    await transport.connect(); first.emit('welcome', { ...welcome }); first.drop();
    let resolve!: (value: ReturnType<typeof room>) => void;
    stub.reconnect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(250); await transport.leave();
    const late = room(); resolve(late); await vi.advanceTimersByTimeAsync(1);
    expect(late.leave).toHaveBeenCalled(); expect(transport.active).toBe(false);
  });
  it('retains only a tab-private token on page suspension and rejects expired reload recovery', async () => {
    const first = room(); stub.room = first;
    const { client: transport } = client(); await transport.connect(); first.emit('welcome', { ...welcome });
    transport.suspend(); expect(transport.active).toBe(false); expect(transport.canRejoin).toBe(true);
    const { client: reloaded } = client(); const next = room(); stub.reconnect.mockResolvedValueOnce(next);
    await reloaded.rejoin(); next.emit('welcome', { ...welcome, connectionGeneration: 4 });
    expect(reloaded.connected).toBe(true); reloaded.suspend();
    stub.reconnect.mockRejectedValueOnce(new Error('expired'));
    await expect(reloaded.rejoin()).rejects.toThrow('expired');
    expect(reloaded.canRejoin).toBe(false); expect(reloaded.active).toBe(false);
  });
  it('keeps live recovery safe when session storage is unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    const first = room(); stub.room = first;
    const { client: transport } = client(); await transport.connect(); first.emit('welcome', { ...welcome });
    first.drop(); const next = room(); stub.reconnect.mockResolvedValueOnce(next);
    await vi.advanceTimersByTimeAsync(250); next.emit('welcome', { ...welcome, connectionGeneration: 4 });
    expect(transport.connected).toBe(true); expect(transport.canRejoin).toBe(false);
    await transport.leave();
  });
  it('bounds a recovered socket that never supplies a valid fresh ownership handshake', async () => {
    vi.useFakeTimers();
    const first = room(); stub.room = first;
    const { client: transport, callbacks } = client(); await transport.connect(); first.emit('welcome', { ...welcome });
    first.drop(); const next = room(); stub.reconnect.mockResolvedValueOnce(next);
    await vi.advanceTimersByTimeAsync(250);
    next.emit('welcome', { ...welcome, protocolVersion: -1 });
    transport.sendInput(1, 0); expect(next.send).toHaveBeenCalledTimes(1); // hello only
    await vi.advanceTimersByTimeAsync(5000);
    expect(transport.active).toBe(false); expect(transport.canRejoin).toBe(false);
    expect(next.leave).toHaveBeenCalled(); expect(callbacks.result).toHaveBeenLastCalledWith(expect.stringContaining('handshake timed out'));
  });
  it('disables offline buffering, sends owned-generation input and blocks reset-era input until a fresh run', async () => {
    const local = room(); stub.room = local;
    const { client: transport, callbacks } = client();
    await transport.connect();
    expect(local.reconnection).toEqual({ enabled: false, maxEnqueuedMessages: 0 });
    transport.sendInput(1, 0);
    expect(local.send).toHaveBeenCalledTimes(1); // hello only until server assigns ownership
    local.emit('welcome', { ...welcome });
    transport.sendInput(1, 0);
    expect(local.send.mock.calls.at(-1)).toEqual(['input', { protocolVersion, sequence: 1,
      connectionGeneration: 3, runGeneration: 0, referenceTimeMs: 100, x: 1, z: 0 }]);
    transport.reset();
    const before = local.send.mock.calls.length;
    transport.sendInput(0, 1); local.emit('snapshot', snapshot()); transport.sendInput(0, 1);
    expect(local.send).toHaveBeenCalledTimes(before);
    local.emit('snapshot', snapshot(1));
    transport.sendInput(0, 0);
    expect(local.send.mock.calls.at(-1)?.[1]).toMatchObject({ sequence: 2, runGeneration: 1, referenceTimeMs: 111, x: 0, z: 0 });
    local.emit('snapshot', snapshot());
    expect(callbacks.snapshot).toHaveBeenCalledTimes(2);
    await transport.leave();
  });
  it('routes expiry only for the current owned slot/session and uses its fresh server reference', async () => {
    const local = room(); stub.room = local;
    const onExpired = vi.fn();
    const transport = new TransportTestClient('http://127.0.0.1:2567', {
      status: vi.fn(), state: vi.fn(), result: vi.fn(), inputExpired: onExpired,
    });
    await transport.connect(); local.emit('welcome', { ...welcome });
    const expiry = { ...welcome, serverTimeMs: 120, sequence: 4, silenceMs: 250 };
    for (const value of [{ ...expiry, slot: 'p1' }, { ...expiry, connectionGeneration: 2 },
      { ...expiry, runGeneration: 1 }, { ...expiry, silenceMs: NaN }]) local.emit('input-expired', value);
    expect(onExpired).not.toHaveBeenCalled();
    local.emit('input-expired', expiry);
    expect(onExpired).toHaveBeenCalledWith(expiry);
    transport.sendInput(0, 0);
    expect(local.send.mock.calls.at(-1)?.[1]).toMatchObject({ referenceTimeMs: 120, x: 0, z: 0 });
    await transport.leave(); local.emit('input-expired', expiry);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
  it('ignores late old-room callbacks and never replays input after leave/rejoin/disposal', async () => {
    const first = room('first'); stub.room = first;
    const { client: transport, callbacks } = client();
    await transport.connect(); first.emit('welcome', { ...welcome });
    await transport.leave(); transport.sendInput(1, 1);
    const second = room('second'); stub.room = second;
    await transport.connect('second');
    first.emit('welcome', { ...welcome }); first.emit('snapshot', snapshot());
    expect(transport.connected).toBe(false);
    expect(callbacks.snapshot).not.toHaveBeenCalled();
    second.emit('welcome', { ...welcome, connectionGeneration: 4 });
    transport.sendInput(0, 0);
    expect(second.send.mock.calls.at(-1)?.[1]).toMatchObject({ sequence: 1, connectionGeneration: 4, x: 0, z: 0 });
    transport.dispose();
    expect(transport.connected).toBe(false);
    await expect(transport.connect()).rejects.toThrow();
  });
});

describe('private lobby transport', () => {
  const lobby = { protocolVersion, capacity: 2, code: 'ABCDEFGH', epoch: 2, revision: 2, runGeneration: 0, stage: 'lobby', host: 'p2',
    players: [{ slot: 'p2', connected: true, ready: false, restartRequested: false }] };
  it('requires both validated lobby and ownership, binds commands and isolates saved tokens from development rooms', async () => {
    const local = room('ABCDEFGH'); stub.room = local;
    const callbacks = { status: vi.fn(), state: vi.fn(), result: vi.fn(), lobby: vi.fn() };
    const transport = new TransportTestClient('http://127.0.0.1:2567', callbacks, undefined, true);
    await transport.connect();
    local.emit('lobby', lobby); expect(transport.connected).toBe(false);
    local.emit('welcome', { ...welcome }); expect(transport.connected).toBe(true);
    transport.lobbyAction('ready'); expect(local.send.mock.calls.at(-1)).toEqual(['lobby', { protocolVersion, action: 'ready', connectionGeneration: 3, runGeneration: 0, lobbyEpoch: 2 }]);
    expect(callbacks.lobby).toHaveBeenCalledTimes(2); // state before welcome is refreshed after slot assignment
    transport.reset(); expect(local.send.mock.calls.at(-1)?.[0]).toBe('lobby'); expect(local.send.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'restart' });
    transport.suspend(); expect(transport.canRejoin).toBe(true);
    const development = client().client; expect(development.canRejoin).toBe(false);
    const previous = local.send.mock.calls.length; transport.lobbyAction('start'); expect(local.send).toHaveBeenCalledTimes(previous);
  });
  it('rejects invalid/wrong-room lobby data, bounds missing-lobby handshake, and clears expired credentials', async () => {
    vi.useFakeTimers(); const local = room('ABCDEFGH'); stub.room = local;
    const callbacks = { status: vi.fn(), state: vi.fn(), result: vi.fn(), lobby: vi.fn() };
    const transport = new TransportTestClient('http://127.0.0.1:2567', callbacks, undefined, true);
    await expect(transport.connect('not-a-code')).rejects.toThrow('eight-character');
    await transport.connect(); local.emit('welcome', { ...welcome });
    local.emit('lobby', { ...lobby, code: 'BCDEFGHJ' }); local.emit('lobby', { ...lobby, token: 'forged' });
    expect(transport.connected).toBe(false); expect(callbacks.lobby).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); expect(local.leave).toHaveBeenCalled(); expect(transport.canRejoin).toBe(false);
    const next = room('ABCDEFGH'); stub.room = next; await transport.connect(); next.emit('welcome', { ...welcome }); next.emit('lobby', lobby);
    expect(transport.connected).toBe(true); next.emit('room-closed', { protocolVersion, reason: 'idle-timeout' });
    expect(transport.connected).toBe(false); expect(transport.canRejoin).toBe(false);
    expect(callbacks.status).toHaveBeenCalledWith(expect.stringContaining('Room expired'), false);
  });
});
it('negotiates compact private snapshots and applies the same validation, run and disposal boundaries', async () => {
  const local=room('ABCDEFGH');stub.room=local;
  const callbacks={status:vi.fn(),state:vi.fn(),result:vi.fn(),snapshot:vi.fn()};
  const transport=new TransportTestClient('http://127.0.0.1:2567',callbacks,undefined,true);
  await transport.connect();
  expect(local.send).toHaveBeenCalledWith('hello',{protocolVersion,snapshotFormat:'flat-chain-v1'});
  local.emit('welcome',{...welcome,runGeneration:2});
  const message={...snapshot(2),scenarioVersion:4,players:['p1','p2','p3','p4'].map(id=>({...snapshot(2).players[0]!,id})),
    chain:{course:'slack',endpoints:['p1','p2','p3','p4'],segments:Array.from({length:36},()=>[0,1,0,0,0,0,1]).flat()}};
  local.emit('snapshot-compact',message);expect(callbacks.snapshot).toHaveBeenCalledTimes(1);
  expect(callbacks.snapshot.mock.calls[0]![0].chain.segments).toHaveLength(36);
  local.emit('snapshot-compact',{...message,runGeneration:1});
  local.emit('snapshot-compact',{...message,chain:{...message.chain,segments:message.chain.segments.slice(1)}});
  expect(callbacks.snapshot).toHaveBeenCalledTimes(1);
  transport.dispose();local.emit('snapshot-compact',message);expect(callbacks.snapshot).toHaveBeenCalledTimes(1);
});

it('isolates phone/display reclaim storage and completes display handshake without a player or input stream', async () => {
  const callbacks = { status: vi.fn(), state: vi.fn(), result: vi.fn(), displayWelcome: vi.fn(), control: vi.fn() };
  const lobby = { protocolVersion, capacity: 2, code: 'ABCDEFGH', epoch: 1, revision: 1, runGeneration: 0, stage: 'lobby', host: null, players: [] };
  const display = new TransportTestClient('http://127.0.0.1:2567', callbacks, undefined, true, 'display');
  const first = room('ABCDEFGH'); stub.room = first; await display.connect();
  first.emit('lobby', lobby); first.emit('welcome', welcome); expect(display.connected).toBe(false);
  first.emit('display-welcome', { protocolVersion, role: 'display', connectionGeneration: 5, runGeneration: 0, serverTimeMs: 100 });
  expect(display.connected).toBe(true); expect(callbacks.displayWelcome).toHaveBeenCalledOnce();
  const sends = first.send.mock.calls.length; display.sendInput(1, 1); display.sampleInput(); display.probe();
  expect(first.send).toHaveBeenCalledTimes(sends);
  display.suspend();
  const phone = new TransportTestClient('http://127.0.0.1:2567', callbacks, undefined, true, 'controller');
  expect(display.canRejoin).toBe(true); expect(phone.canRejoin).toBe(false);
  await expect(phone.connect()).rejects.toThrow('room code'); await display.leave(); await phone.leave();
});

it('updates phone reference/run from slim status and ignores old run/room callbacks after reconnect', async () => {
  const callbacks = { status: vi.fn(), state: vi.fn(), result: vi.fn(), control: vi.fn() };
  const phone = new TransportTestClient('http://127.0.0.1:2567', callbacks, undefined, true, 'controller');
  const first = room('ABCDEFGH'); stub.room = first; await phone.connect('ABCDEFGH');
  first.emit('welcome', welcome);
  first.emit('lobby', { protocolVersion, capacity: 2, code: 'ABCDEFGH', epoch: 1, revision: 1, runGeneration: 0, stage: 'lobby', host: 'p2', players: [{ slot: 'p2', connected: true, ready: false, restartRequested: false }] });
  const control = { protocolVersion, runGeneration: 2, serverTimeMs: 200, phase: 'running', outcome: 'active', displayActive: true };
  first.emit('controller-status', control); phone.sendInput(0, 0);
  expect(first.send.mock.calls.at(-1)?.[1]).toMatchObject({ runGeneration: 2, referenceTimeMs: 200 });
  first.emit('controller-status', { ...control, runGeneration: 1 }); expect(callbacks.control).toHaveBeenCalledOnce();
  phone.suspend(); first.emit('controller-status', { ...control, runGeneration: 3 }); expect(callbacks.control).toHaveBeenCalledOnce();
  await phone.leave();
});
