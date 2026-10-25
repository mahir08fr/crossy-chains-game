import { NamedFeedback } from './named-feedback';
const namedFeedback = new NamedFeedback();
import { NameInput } from './name-input';
import { railwayFeedback } from './railway-feedback';
import { waterFeedback } from './water-feedback';
import './couch.css';
import './controller-ui.css';
import { CouchDiagnostics, pauseCause } from './couch-diagnostics';
import type { PlayerSlot } from '@crossy/protocol';
import { isPrivateCode } from '@crossy/protocol';
import { TransportTestClient } from './network-client';
import { readTransportEndpoint } from './network-endpoint';
import { VirtualJoystick } from './joystick';
import { ControllerInput } from './controller-input';
import { CouchLobbyView, element, playerNames, setText } from './couch-ui';

const endpoint = readTransportEndpoint(import.meta.env.VITE_SERVER_URL, location.protocol === 'https:');
const status = element('status'), result = element('result'), code = element<HTMLInputElement>('room-id');
let confirmingLeave = false, leaving = false;
let slot: PlayerSlot | undefined, busy = false, disposed = false, focused = true;
let timer: ReturnType<typeof setInterval> | undefined;
const joystick = new VirtualJoystick(element('joystick'), element('joystick-knob'), () => client.sendInput(0, 0));
const diagnostics = new CouchDiagnostics((event, detail) => client.reportControllerEvent(event, detail));
const pump = new ControllerInput((x, z) => client.sendInput(x, z), () => joystick.clear(), (event, detail) => diagnostics.event(event, detail));
const view = new CouchLobbyView(false, action => { if (action === 'restart') joystick.clear(); client.lobbyAction(action); });
const nameInput = new NameInput(element('controller-name'), name => client.setDisplayName(name));
function buttons(): void {
  element<HTMLButtonElement>('join').disabled = busy || client.active;
  code.disabled = busy || client.active;
  element<HTMLButtonElement>('rejoin').disabled = busy || client.active || !client.canRejoin;
  element<HTMLButtonElement>('leave').disabled = !client.active;
}
const client = new TransportTestClient(endpoint, {
  state: () => undefined,
  health: message => diagnostics.receive(message),
  status: (message, connected) => {
    diagnostics.event('connection', { connected });
    setText(status, message); view.connection(connected); buttons();
    if (!connected) { slot = undefined; nameInput.clear(); pump.reset(); joystick.setEnabled(false); element('identity').textContent = 'Your phone. Your player.'; delete document.body.dataset.slot; }
    syncPump();
  },
  welcome: message => {
    diagnostics.event('welcome');
    slot = message.slot; document.body.dataset.slot = slot;
    element('identity').textContent = playerNames[slot]; pump.reset(); client.sendInput(0, 0);
  },
  lobby: message => { namedFeedback.update(message); code.value = message.code; view.update(message, slot); nameInput.update(message, slot); if (slot) element('identity').textContent = `${message.players.find(p=>p.slot===slot)?.displayName ?? ''} · ${playerNames[slot]}`; },
  lobbyRejected: reason => { nameInput.feedback('Action unavailable'); result.textContent = `Action unavailable (${reason}). Check the room status and try again.`; },
  result: message => { nameInput.feedback(message); if (!message.startsWith('Ping')) setText(result, message); },
  clock: (server, sent, received) => { pump.clock(server, sent, received); element('ping').textContent = `Ping ${Math.round(received - sent)} ms`; },
  control: message => {
    pump.receive(message, performance.now()); view.gamePhase(message.phase, !!message.endless);
    setText(result, !message.displayActive ? 'Display disconnected or hidden. Waiting safely for the shared screen.'
      : message.railway ? namedFeedback.format(railwayFeedback(message.railway)) + (message.phase === 'paused' ? ' · Team paused safely; release and touch again.' : '')
      : message.river ? namedFeedback.format(waterFeedback(message.river)) + (message.phase === 'paused' ? ' · Team paused safely; release and touch again.' : '')
      : message.outcome === 'failed' ? message.endless ? 'Team failed. Every phone votes to restart the same seed.' : 'Team failed. The host or display can restart.'
      : message.outcome === 'cleared' ? 'Road crossed together! Ready for another run?'
      : message.phase === 'fault' ? message.endless ? 'Physics fault. Every phone votes to restart safely.' : 'Game paused after a physics fault. The host can restart.'
      : message.phase === 'waiting' ? 'Everyone choose Ready. The host starts the team.'
      : message.phase === 'paused' ? `Waiting safely for every controller. Release, then touch again. ${pauseCause(diagnostics.health)}`
      : 'Watch the shared screen. Drag up to move forward.');
  },
  inputExpired: () => { diagnostics.event('input-expired'); joystick.clear(); if (!document.hidden && focused) client.sendInput(0, 0); },
  rejected: reason => {
    diagnostics.event('input-rejected', { code: reason });
    if (reason === 'requires-neutral' || reason === 'invalid-generation') {
      joystick.clear();
      // Wait for the next status/pump on generation mismatch; immediately
      // replying with the same old generation can create a rejection loop.
      if (reason === 'requires-neutral' && !document.hidden && focused) client.sendInput(0, 0);
      return true;
    }
    return reason === 'stale-input';
  },
}, undefined, true, 'controller');
function update(): void {
  const enabled = pump.update(performance.now(), !document.hidden && focused && !confirmingLeave, client.connected, () => joystick.sample());
  joystick.setEnabled(enabled);
}
function release(): void { joystick.clear(); client.sendInput(0, 0); joystick.setEnabled(false); }
function syncPump(): void {
  clearInterval(timer); timer = undefined;
  if (!document.hidden && focused && client.connected) { update(); timer = setInterval(update, 1000 / 30); }
  else joystick.setEnabled(false);
}
const probeTimer = setInterval(() => { if (!document.hidden) client.probe(); }, 2000);
const events = new AbortController(), options = { signal: events.signal };
const connect = async (reclaim = false) => {
  busy = true; buttons(); release();
  try { await (reclaim ? client.rejoin() : client.connect(code.value.replace(/[-\s]/g, '').toUpperCase())); client.probe(); }
  catch (error) { result.textContent = error instanceof Error ? error.message : 'Could not connect'; }
  finally { busy = false; buttons(); }
};
element('join').addEventListener('click', () => { void connect(); }, options);
element('rejoin').addEventListener('click', () => { void connect(true); }, options);
const leaveDialog = element<HTMLDialogElement>('controller-leave-dialog');
const cancelLeave = () => { if (leaving) return; leaveDialog.close(); confirmingLeave = false; release(); element('leave').focus(); };
element('leave').addEventListener('click', () => { confirmingLeave = true; release(); leaveDialog.showModal(); element('controller-leave-cancel').focus(); }, options);
element('controller-leave-cancel').addEventListener('click', cancelLeave, options);
leaveDialog.addEventListener('cancel', event => { event.preventDefault(); cancelLeave(); }, options);
element('controller-leave-confirm').addEventListener('click', () => {
  if (leaving) return; leaving = true; release();
  element<HTMLButtonElement>('controller-leave-confirm').disabled = element<HTMLButtonElement>('controller-leave-cancel').disabled = true;
  void client.leave().then(() => { leaveDialog.close(); confirmingLeave = false; }).catch(() => { element('controller-leave-feedback').textContent = 'Could not leave cleanly. Please try again.'; }).finally(() => { leaving = false; element<HTMLButtonElement>('controller-leave-confirm').disabled = element<HTMLButtonElement>('controller-leave-cancel').disabled = false; });
}, options);
window.addEventListener('blur', () => { diagnostics.event('blur', { hidden: document.hidden }); focused = false; release(); syncPump(); }, options);
window.addEventListener('focus', () => { diagnostics.event('focus', { hidden: document.hidden }); focused = true; release(); syncPump(); }, options);
window.addEventListener('orientationchange', () => { diagnostics.event('orientation'); release(); }, options);
window.addEventListener('resize', () => { diagnostics.event('resize'); release(); }, options);
document.addEventListener('visibilitychange', () => { diagnostics.event('visibility', { hidden: document.hidden }); release(); if (!document.hidden) { focused = true; client.probe(); } syncPump(); }, options);
window.addEventListener('pagehide', () => { diagnostics.event('pagehide'); release(); pump.reset(); client.suspend(); }, options);
window.addEventListener('pageshow', event => { diagnostics.event('pageshow'); if (event.persisted) { release(); if (!client.active && client.canRejoin) void connect(true); } }, options);
const invite = location.hash.slice(1).toUpperCase(); if (isPrivateCode(invite)) code.value = invite;
buttons();
const dispose = () => {
  if (disposed) return; disposed = true; events.abort(); clearInterval(timer); clearInterval(probeTimer);
  release(); joystick.dispose(); view.dispose(); nameInput.dispose(); client.dispose();
};
if (import.meta.hot) import.meta.hot.dispose(dispose);
