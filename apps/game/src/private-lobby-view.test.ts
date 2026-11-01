import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { protocolVersion } from '@crossy/protocol';
import type { LobbyMessage } from '@crossy/protocol';
import { PrivateLobbyView } from './private-lobby-view';
class Element extends EventTarget { textContent = ''; value = ''; hidden = false; disabled = false; focus = vi.fn(); select = vi.fn(); }
let nodes: Map<string, Element>, copy: ReturnType<typeof vi.fn>;
const node = (id: string) => nodes.get(id)!;
const state = (): LobbyMessage => ({ protocolVersion, capacity: 2, code: 'ABCDEFGH', epoch: 2, revision: 2, runGeneration: 0, stage: 'lobby', host: 'p1',
  players: [{ slot: 'p1', connected: true, ready: false, restartRequested: false }, { slot: 'p2', connected: true, ready: false, restartRequested: false }] });
beforeEach(() => {
  nodes = new Map(); copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('document', { getElementById: (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return node(id); } });
  vi.stubGlobal('window', { location: { href: 'https://example.test/play.html' } });
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
});
afterEach(() => vi.unstubAllGlobals());
it('shows role/readiness, permits only host start, and keeps invite free of reclaim credentials', async () => {
  const command = vi.fn(), view = new PrivateLobbyView(command), data = state();
  view.connection(true); view.update(data, 'p1');
  expect(node('start').disabled).toBe(true); expect(node('reset').disabled).toBe(true);
  expect(node('member-p1').textContent).toContain('You · Host');
  expect(node('invite-link').value).toBe('https://example.test/play.html#ABCDEFGH');
  node('ready').dispatchEvent(new Event('click')); expect(command).toHaveBeenCalledWith('ready');
  data.players.forEach(p => { p.ready = true; }); view.update(data, 'p1');
  expect(node('start').disabled).toBe(false); node('start').dispatchEvent(new Event('click')); expect(command).toHaveBeenCalledWith('start');
  view.update(data, 'p2'); expect(node('start').disabled).toBe(true); expect(node('ready').textContent).toBe('Not ready');
  node('copy-invite').dispatchEvent(new Event('click')); await Promise.resolve();
  expect(copy).toHaveBeenCalledWith('https://example.test/play.html#ABCDEFGH'); view.dispose();
});
it('explains restart agreement, terminal permissions and reserved/reconnecting state', () => {
  const command = vi.fn(), view = new PrivateLobbyView(command), data = state(); data.stage = 'playing';
  view.connection(true); view.update(data, 'p2'); view.gamePhase('running'); expect(node('reset').disabled).toBe(false);
  data.players[1]!.restartRequested = true; view.update(data, 'p2'); expect(node('cancel-restart').hidden).toBe(false);
  node('cancel-restart').dispatchEvent(new Event('click')); expect(command).toHaveBeenCalledWith('cancel-restart');
  view.gamePhase('ended'); expect(node('reset').disabled).toBe(true); view.update(data, 'p1'); expect(node('reset').disabled).toBe(false);
  data.players[1]!.connected = false; data.players[1]!.restartRequested = false; view.update(data, 'p1');
  expect(node('reset').disabled).toBe(true); expect(node('member-p2').textContent).toContain('slot reserved');
  view.connection(false); expect(node('ready').disabled).toBe(true); view.rejected('stale-command'); expect(node('lobby-feedback').textContent).toContain('room changed');
  view.clear(); expect(node('lobby-panel').hidden).toBe(true); view.dispose();
});

it('retains action button text nodes across unchanged snapshots and lobby heartbeats', () => {
  const view = new PrivateLobbyView(vi.fn()), data = state();
  view.connection(true); view.update(data, 'p1');
  for (const id of ['ready', 'reset']) {
    const value = node(id).textContent, write = vi.fn();
    Object.defineProperty(node(id), 'textContent', { configurable: true, get: () => value, set: write });
    for (let i = 0; i < 30; i++) { view.gamePhase('waiting'); view.update(structuredClone(data), 'p1'); }
    expect(write).not.toHaveBeenCalled();
  }
  view.dispose();
});
it('requires all four connected/ready seats and shows distinct four-player status and votes', () => {
  const view = new PrivateLobbyView(vi.fn()), data = state(); data.capacity = 4;
  data.players.push({ slot: 'p3', connected: true, ready: true, restartRequested: false }, { slot: 'p4', connected: true, ready: false, restartRequested: false });
  data.players[0]!.ready = data.players[1]!.ready = true;
  view.connection(true); view.update(data, 'p1'); expect(node('start').disabled).toBe(true);
  expect(node('member-p4').hidden).toBe(false); expect(node('member-p3').textContent).toContain('Capybara');
  data.players[3]!.ready = true; view.update(data, 'p1'); expect(node('start').disabled).toBe(false);
  data.stage = 'playing'; data.players.forEach(p => { p.ready = false; }); view.update(data, 'p4'); view.gamePhase('running');
  expect(node('reset').disabled).toBe(false); expect(node('member-p4').textContent).toContain('You');
  data.players[2]!.connected = false; view.update(data, 'p4'); expect(node('reset').disabled).toBe(true);
  expect(node('member-p3').textContent).toContain('slot reserved'); view.dispose();
});

it('enables every endless player to vote after shared death and shows the actual vote count',()=>{
 const view=new PrivateLobbyView(vi.fn()),data=state();data.stage='playing';data.players.forEach(p=>p.ready=false);
 view.connection(true);view.update(data,'p2');view.gamePhase('ended',true);
 expect(node('reset').disabled).toBe(false);expect(node('reset').textContent).toContain('0/2');
 data.players[0]!.restartRequested=true;view.update(data,'p2');expect(node('reset').textContent).toContain('1/2');
 expect(node('lobby-hint').textContent).toContain('Every player votes');view.dispose();
});
