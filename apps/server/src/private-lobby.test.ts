import { expect, it } from 'vitest';
import { isLobbyCommand, isLobbyMessage, isPrivateCode, protocolVersion } from '@crossy/protocol';
import { lobbyIdleMs, PrivateLobby, reservePrivateCode } from './private-lobby.js';
function pair() { const lobby = new PrivateLobby('ABCDEFGH', 0); lobby.join('p1', 1); lobby.join('p2', 2); return lobby; }
function act(lobby: PrivateLobby, slot: 'p1' | 'p2', action: Parameters<PrivateLobby['command']>[2], terminal = false, now = 3) {
  return lobby.command(slot, lobby.state(0).epoch, action, terminal, now);
}
it('starts only with both ready, two connected and current host; duplicate ready remains valid', () => {
  const lobby = pair();
  expect(act(lobby, 'p2', 'start').error).toBe('not-host'); expect(act(lobby, 'p1', 'start').error).toBe('not-ready');
  const epoch = lobby.state(0).epoch;
  expect(lobby.command('p1', epoch, 'ready', false, 3)).toEqual({});
  expect(lobby.command('p2', epoch, 'ready', false, 4)).toEqual({});
  const ready = lobby.state(0); act(lobby, 'p1', 'ready'); expect(lobby.state(0)).toEqual(ready);
  expect(act(lobby, 'p1', 'start')).toEqual({ effect: 'start' });
  expect(lobby.acceptsJoin).toBe(false); expect(isLobbyMessage(lobby.state(0))).toBe(true);
  expect(() => lobby.join('p1', 5)).toThrow(); expect(act(lobby, 'p2', 'ready').error).toBe('not-in-lobby');
});
it('requires restart agreement in the same membership epoch; allows cancellation and host terminal restart', () => {
  const lobby = pair(); act(lobby, 'p1', 'ready'); act(lobby, 'p2', 'ready'); act(lobby, 'p1', 'start');
  expect(act(lobby, 'p1', 'restart')).toEqual({}); expect(lobby.state(0).players[0]!.restartRequested).toBe(true);
  act(lobby, 'p1', 'cancel-restart'); expect(act(lobby, 'p2', 'restart')).toEqual({});
  expect(act(lobby, 'p1', 'restart')).toEqual({ effect: 'restart' });
  expect(lobby.state(1).players.every(p => !p.restartRequested)).toBe(true);
  expect(act(lobby, 'p2', 'restart', true).error).toBe('not-host');
  expect(act(lobby, 'p1', 'restart', true)).toEqual({ effect: 'restart' });
});
it('transfers dropped host, rejects stale commands and keeps reclaimed host from stealing ownership', () => {
  const lobby = pair(); act(lobby, 'p1', 'ready'); act(lobby, 'p2', 'ready'); act(lobby, 'p1', 'start');
  const old = lobby.state(0).epoch; act(lobby, 'p2', 'restart'); lobby.connection('p1', false, 10);
  expect(lobby.state(0)).toMatchObject({ host: 'p2', stage: 'playing' });
  expect(lobby.command('p2', old, 'restart', false, 11).error).toBe('stale-command');
  expect(act(lobby, 'p2', 'restart').error).toBe('need-two-players');
  lobby.connection('p1', true, 12); expect(lobby.state(0).host).toBe('p2');
  expect(lobby.state(0).players.every(p => !p.restartRequested && !p.ready)).toBe(true);
  lobby.leave('p2', 13); expect(lobby.state(1)).toMatchObject({ host: 'p1', stage: 'lobby' });
  lobby.join('p2', 14); expect(act(lobby, 'p1', 'start').error).toBe('not-ready');
});
it('bounds inactive lobbies without no-op activity extensions; playing rooms and disconnected reservations remain coherent', () => {
  const lobby = pair();
  expect(lobby.expired(2 + lobbyIdleMs - 1)).toBe(false);
  act(lobby, 'p1', 'unready', false, lobbyIdleMs); // no-op cannot keep a lobby alive
  expect(lobby.expired(2 + lobbyIdleMs)).toBe(true);
  act(lobby, 'p1', 'ready', false, lobbyIdleMs + 1);
  expect(lobby.expired(lobbyIdleMs + 2)).toBe(false);
  lobby.connection('p1', false, 10); lobby.connection('p2', false, 11);
  expect(lobby.state(0).host).toBeNull(); expect(isLobbyMessage(lobby.state(0))).toBe(true);
  lobby.connection('p2', true, 12); expect(lobby.state(0).host).toBe('p2');
  lobby.connection('p1', true, 13); act(lobby, 'p1', 'ready'); act(lobby, 'p2', 'ready'); act(lobby, 'p2', 'start');
  expect(lobby.expired(lobbyIdleMs * 100)).toBe(false);
});
it('allocates bounded unambiguous unique codes, retries collisions and supports release', () => {
  const codes = new Set(['AAAAAAAA']); let calls = 0;
  expect(reservePrivateCode(codes, () => calls++ < 8 ? 0 : 1)).toBe('BBBBBBBB');
  expect(() => reservePrivateCode(codes, () => 0)).toThrow(); codes.delete('AAAAAAAA');
  expect(reservePrivateCode(codes, () => 0)).toBe('AAAAAAAA');
  for (let i = 0; i < 50; i++) expect(isPrivateCode(reservePrivateCode(codes))).toBe(true);
  expect(codes.size).toBe(52);
});
it('strictly rejects forged or malformed lobby wire data and returns independent message copies', () => {
  const lobby = pair(), good = lobby.state(3); expect(isLobbyMessage(good)).toBe(true);
  const command = { protocolVersion, connectionGeneration: 4, runGeneration: 3, lobbyEpoch: good.epoch, action: 'ready' };
  expect(isLobbyCommand(command)).toBe(true);
  for (const bad of [{ ...command, slot: 'p1' }, { ...command, action: 'teleport' }, { ...command, lobbyEpoch: NaN }, { ...command, connectionGeneration: -1 }]) expect(isLobbyCommand(bad)).toBe(false);
  for (const bad of [{ ...good, code: 'SECRET' }, { ...good, token: 'hidden' }, { ...good, host: null }, { ...good, players: [good.players[0], good.players[0]] }, { ...good, players: [{ ...good.players[0], connected: false, ready: true }] }]) expect(isLobbyMessage(bad)).toBe(false);
  good.players[0]!.ready = true; expect(lobby.state(3).players[0]!.ready).toBe(false);
});
it('four-player policy requires every configured seat, cancels votes on boundaries and transfers deterministically', () => {
  const lobby = new PrivateLobby('ABCDEFGH', 0, 4);
  const command = (slot: 'p1' | 'p2' | 'p3' | 'p4', action: Parameters<PrivateLobby['command']>[2]) => lobby.command(slot,lobby.state(0).epoch,action,false,10);
  lobby.join('p1',1); lobby.join('p3',2); lobby.join('p2',3);
  for (const slot of ['p1','p2','p3'] as const) command(slot,'ready');
  expect(command('p1','start').error).toBe('need-two-players');
  lobby.join('p4',4); expect(lobby.state(0).players.every(p=>!p.ready)).toBe(true);
  for (const slot of ['p1','p2','p3','p4'] as const) command(slot,'ready');
  expect(command('p1','start').effect).toBe('start');
  for (const slot of ['p1','p2','p3'] as const) expect(command(slot,'restart')).toEqual({});
  expect(command('p4','restart').effect).toBe('restart');
  command('p1','restart'); lobby.connection('p1',false,11);
  expect(lobby.state(0).host).toBe('p2'); expect(lobby.state(0).players.every(p=>!p.restartRequested)).toBe(true);
  lobby.connection('p1',true,12); expect(lobby.state(0).host).toBe('p2');
});
