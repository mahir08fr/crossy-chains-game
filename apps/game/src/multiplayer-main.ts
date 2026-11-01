import { gameShell } from './game-shell';
import { setMenuScene } from './menu-scene';
import { canHostStart } from './gui-state';
import type { LobbyMessage } from '@crossy/protocol';
import { NamedFeedback } from './named-feedback';
const namedFeedback = new NamedFeedback();
import { NameInput } from './name-input';
import { generatedFeedback } from './generated-feedback';
import { railwayFeedback } from './railway-feedback';
import { waterFeedback } from './water-feedback';
if (!gameShell) { await import('./multiplayer.css'); await import('./private-lobby.css'); }
import { PerformanceMetrics, formatServerPerformance } from './performance-metrics';
import { PrivateLobbyView } from './private-lobby-view';
import { generatedScenario, groupScenario, railwayScenario, riverScenario, roadScenario, scenarios } from '@crossy/config';
import { isChainCourse, isPrivateCode } from '@crossy/protocol';
import type { GroupSize, PlayerSlot, RoomPhase } from '@crossy/protocol';
import { KeyboardInput } from './input';
import { GameRenderer } from './renderer';
import { TransportTestClient } from './network-client';
import { readTransportEndpoint } from './network-endpoint';
import { NetworkInputSender } from './network-input';
import { SnapshotBuffer } from './snapshot-buffer';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing movement test element: ${id}`);
  return result as T;
}
const create = element<HTMLButtonElement>('create'), join = element<HTMLButtonElement>('join');
const leave = element<HTMLButtonElement>('leave'), reset = element<HTMLButtonElement>('reset');
const rejoin = element<HTMLButtonElement>('rejoin');
const roomId = element<HTMLInputElement>('room-id');
const status = element('status'), result = element('result'), metrics = element('metrics');
const viewport = element('viewport');
const endpoint = readTransportEndpoint(import.meta.env.VITE_SERVER_URL, window.location.protocol === 'https:');
element('endpoint').textContent = endpoint;
const renderer = new GameRenderer(viewport);
renderer.setScenario(scenarios[0]!);
renderer.chain.group.visible = false;
const buffer = new SnapshotBuffer();
const privatePage = !!gameShell || window.location.pathname === '/play.html';
let currentLobby: LobbyMessage | undefined;
let pendingStart: {epoch:number;run:number} | undefined;
let lastMenuDraw = 0;
if (gameShell) setMenuScene(renderer);
const lobbyView = privatePage ? new PrivateLobbyView(action => client.lobbyAction(action)) : undefined;
const nameInput = privatePage ? new NameInput(element(gameShell ? 'own-name' : 'lobby-panel'), name => client.setDisplayName(name)) : undefined;
const requestedCourse = new URLSearchParams(window.location.search).get('chain');
const chainCourse = isChainCourse(requestedCourse) ? requestedCourse : undefined;
let carLoading: Promise<void> | undefined;
let carStatus = 'Car not loaded';
let slot: PlayerSlot | undefined, previousPhase: RoomPhase | undefined;
let busy = false, snapCamera = true, disposed = false, frame = 0;
let lastFrameAt = performance.now(), lastMetricsAt = -Infinity;
let rttMs: number | undefined;
let lastPumpAt: number | undefined;
let lastInputEvent = 'No input clearing';
const performanceMetrics = new URLSearchParams(window.location.search).get('performance') === '1' ? new PerformanceMetrics() : undefined;
let serverPerformance = '';
let previousSnapshotAt: number | undefined;
const performancePanel = performanceMetrics ? document.createElement('pre') : undefined;
if (performancePanel) { performancePanel.id = 'performance-metrics'; performancePanel.style.cssText = 'position:fixed;bottom:0;left:0;z-index:100;background:#102128ed;color:white;padding:8px;font-size:11px;pointer-events:none'; document.body.append(performancePanel); }
let longTasks: PerformanceObserver | undefined;
if (performanceMetrics && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  longTasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) performanceMetrics.record('long task ms', entry.duration); });
  longTasks.observe({ entryTypes: ['longtask'] });
}
const inputDiagnostics = new URLSearchParams(window.location.search).get('inputDiagnostics') === '1';
const diagnose = (event: string, detail: object = {}) => {
  if (inputDiagnostics) console.info('[Crossy input]', { event, ...detail,
    slot, phase: buffer.latest?.phase, run: buffer.latest?.runGeneration,
    focused: document.hasFocus(), hidden: document.hidden, snapshotAgeMs: buffer.ageMs(performance.now()) });
};
const client = new TransportTestClient(endpoint, {
  performance: performanceMetrics ? message => { serverPerformance = formatServerPerformance(message); } : undefined,
  status: (message, connected) => {
    status.textContent = message;
    lobbyView?.connection(connected);
    gameShell?.connection(connected, client.active);
    if (!connected) pendingStart = undefined;
    if (!connected && !client.active) { if (gameShell) setMenuScene(renderer); currentLobby = undefined; lobbyView?.clear(); nameInput?.clear(); renderer.labels.resetNames(); if (privatePage) result.textContent = 'Create a private room or join your teammate.'; }
    create.disabled = join.disabled = roomId.disabled = client.active || busy;
    if (privatePage) { element<HTMLSelectElement>('group-size').disabled = client.active || busy; element<HTMLSelectElement>('course').disabled = client.active || busy; }
    leave.disabled = !client.active; if (!lobbyView) reset.disabled = !connected;
    rejoin.disabled = client.active || busy || !client.canRejoin;
    if (!connected) {
      slot = undefined; previousPhase = undefined;
      buffer.clear(); renderer.clearEffects(); input.clear('disconnected'); sender.clear(); snapCamera = true; lastPumpAt = undefined;
      metrics.textContent = 'Awaiting server snapshots.';
    }
  },
  welcome: (message) => { slot = message.slot; input.clear('welcome'); sender.clear(); client.sendInput(0, 0); },
  state: () => undefined,
  lobby: message => { namedFeedback.update(message); renderer.setNames(message); nameInput?.update(message, slot); lobbyView?.update(message, slot); currentLobby = message; gameShell?.lobby(message,slot);
    if (pendingStart) { const queued = pendingStart; if (message.epoch !== queued.epoch || message.runGeneration !== queued.run || !canHostStart(message,slot)) pendingStart = undefined; else if (message.players.find(p=>p.slot===slot)?.ready) { pendingStart = undefined; client.lobbyAction('start'); } }
    if (privatePage) element<HTMLSelectElement>('group-size').value = String(message.capacity); },
  lobbyRejected: reason => { nameInput?.feedback('Action unavailable'); pendingStart = undefined; lobbyView?.rejected(reason); if(gameShell) element('menu-feedback').textContent = element('lobby-feedback').textContent; },
  result: (message) => { result.textContent = message; nameInput?.feedback(message); if(gameShell) element('invite-feedback').textContent = message.startsWith('Ping') ? '' : message; },
  clock: (serverTimeMs, sentAt, receivedAt) => {
    rttMs = receivedAt - sentAt;
    buffer.observeClock(serverTimeMs, sentAt, receivedAt);
  },
  inputExpired: (message) => {
    performanceMetrics?.count('own input expiry');
    input.clear('server-expiry'); sender.clear();
    lastInputEvent = `Your stream expired after ${message.silenceMs.toFixed(0)} ms without accepted input`;
    result.textContent = `Input cleared · ${lastInputEvent}.`;
    diagnose('server-input-expired', { sequence: message.sequence, silenceMs: message.silenceMs });
    client.sendInput(0, 0);
  },
  rejected: (code) => {
    diagnose('packet-rejected', { code });
    if (code === 'stale-input') {
      // An obsolete packet is not proof that this connection's live input expired.
      result.textContent = 'Outdated input packet dropped · retrying current input.';
      return true;
    }
    if (code === 'requires-neutral' || code === 'invalid-generation') {
      input.clear(code); sender.clear();
      lastInputEvent = code === 'requires-neutral' ? 'Your stream needs fresh neutral input' : 'Session generation changed';
      result.textContent = `Input cleared · ${lastInputEvent}.`;
      return true;
    }
  },
  snapshot: (snapshot) => {
    const arrivedAt = performance.now();
    if (previousSnapshotAt !== undefined) performanceMetrics?.record('snapshot interval ms', arrivedAt - previousSnapshotAt);
    previousSnapshotAt = arrivedAt;
    if (snapshot.scenarioVersion !== 1 && snapshot.scenarioVersion !== 2 && snapshot.scenarioVersion !== 3 && snapshot.scenarioVersion !== 4 && snapshot.scenarioVersion !== 5 && snapshot.scenarioVersion !== 6 && snapshot.scenarioVersion !== 7) { result.textContent = 'Unsupported room scenario · leave and update this client.'; return; }
    const previousRun = buffer.latest?.runGeneration;
    if (!buffer.push(snapshot, performance.now())) return;
    lobbyView?.gamePhase(snapshot.phase, !!snapshot.world);
    if (privatePage) element<HTMLSelectElement>('course').value = snapshot.world ? 'generated' : snapshot.railway ? 'railway' : snapshot.river ? 'river' : 'road';
    if (previousRun !== snapshot.runGeneration) {
      input.clear('run-generation'); sender.clear(); snapCamera = true;
      if (privatePage && previousRun !== undefined && snapshot.runGeneration > 0) viewport.focus();
      renderer.setScenario(groupScenario(snapshot.world ? generatedScenario : snapshot.railway ? railwayScenario : snapshot.river ? riverScenario : snapshot.chain?.course === 'road' ? roadScenario : scenarios.find(({ id }) => id === (snapshot.chain?.course ?? 'foundation'))!, snapshot.players.length as GroupSize));
      if (snapshot.road && !carLoading) {
        carLoading = renderer.traffic.load().then(() => { carStatus = 'Blender car loaded'; })
          .catch(() => { carStatus = 'Car asset unavailable · box fallback'; });
      }
      renderer.chain.setCount(snapshot.chain?.segments.length ?? 0);
      renderer.chain.group.visible = !!snapshot.chain;
      for (const view of renderer.players.values()) view.reset();
      if (previousRun !== undefined) result.textContent = `${snapshot.chain ? `Chain course ${snapshot.chain.course} · ${snapshot.chain.segments.length} physical spans · ` : ''}Run ${snapshot.runGeneration} reset · press fresh movement keys after resuming.`;
    }
    if (snapshot.road) {
      result.textContent = snapshot.road.outcome === 'failed'
        ? `Team failed · ${namedFeedback.format(snapshot.road.dead.join(' and '))} struck by traffic. ${privatePage ? 'The host can restart the team.' : 'Press R or Restart to retry together.'}`
        : snapshot.road.outcome === 'cleared' ? 'Road crossed together! Press R or Restart to play again.'
        : 'Cross all three lanes together. Rest on the green median; reach the far checkered line.';
    }
    if (snapshot.railway) result.textContent = namedFeedback.format(railwayFeedback(snapshot.railway)) + (snapshot.phase === 'paused' ? ' · Team paused safely.' : '') + (renderer.railway.group.userData.asset?.includes('unavailable') ? ' · Train asset unavailable; collision boxes shown.' : '');
    if (snapshot.world) result.textContent = namedFeedback.format(generatedFeedback(snapshot.world, snapshot.phase, snapshot.run));
    if (snapshot.river) result.textContent = namedFeedback.format(waterFeedback(snapshot.river)) + (snapshot.phase === 'paused' ? ' · Team paused safely.' : '');
    if (snapshot.phase !== previousPhase) {
      diagnose('server-phase', { from: previousPhase, to: snapshot.phase });
      // A peer's pause suspends drive, without erasing this healthy owned gesture.
      // Own expiry has a targeted message; own receive/send stalls still clear below.
      if (snapshot.phase === 'waiting' || snapshot.phase === 'fault' || snapshot.phase === 'ended') { input.clear(snapshot.phase); sender.clear(); }
      previousPhase = snapshot.phase;
    }
    renderer.observeSnapshot(snapshot);
    gameShell?.snapshot(snapshot);
  },
}, chainCourse, privatePage);
const requestReset = () => { input.clear('reset'); sender.clear(); client.reset(); };
const input = new KeyboardInput(() => { if (!gameShell?.inputBlocked) requestReset(); }, () => undefined, (reason, hadKeys) => {
  if (!hadKeys) return;
  const descriptions: Record<string, string> = {
    blur: 'Window lost focus', hidden: 'Tab hidden', 'snapshots-stale': 'Server updates became stale',
    'sender-stall': 'Browser input updates paused', disconnected: 'Disconnected',
    'run-generation': 'Room reset', reset: 'Reset requested', waiting: 'Waiting for another player', fault: 'Simulation fault',
  };
  lastInputEvent = descriptions[reason] ?? reason;
  diagnose('client-input-clear', { reason });
  if (['blur', 'hidden', 'snapshots-stale', 'sender-stall'].includes(reason)) result.textContent = `Input cleared · ${lastInputEvent}.`;
});
const sender = new NetworkInputSender((x, z) => client.sendInput(x, z));
const updateInput = () => {
  const now = performance.now();
  if (lastPumpAt !== undefined && now - lastPumpAt >= 250) {
    diagnose('client-schedule-gap', { gapMs: now - lastPumpAt });
    input.clear('sender-stall'); sender.clear();
  }
  lastPumpAt = now;
  const latest = buffer.latest;
  const ready = client.connected && !!latest && buffer.ageMs(performance.now()) < 250;
  if (!ready) input.clear(client.connected ? 'snapshots-stale' : 'disconnected');
  const axes = ready && latest.phase === 'running' && !gameShell?.inputBlocked ? input.sample().p1 : undefined;
  sender.update(performance.now(), axes ?? { x: 0, z: 0 }, ready);
};
// Independent from RAF so a visible, unfocused observer keeps its neutral stream alive.
gameShell?.bind({
  clearInput: () => { input.clear('menu'); sender.clear(); client.sendInput(0,0); },
  hostStart: () => {
    if (!canHostStart(currentLobby,slot)) return;
    if (currentLobby!.players.find(p=>p.slot===slot)?.ready) client.lobbyAction('start');
    else { pendingStart = {epoch:currentLobby!.epoch,run:currentLobby!.runGeneration}; client.lobbyAction('ready'); }
  },
  ready: () => element<HTMLButtonElement>('ready').click(),
  restart: requestReset, leave: () => client.leave(),
});
const inputTimer = window.setInterval(updateInput, 1000 / 30);
const probeTimer = window.setInterval(() => client.probe(), 2000);
const events = new AbortController(), options = { signal: events.signal };
for (const type of ['keydown', 'keyup', 'blur', 'focus']) window.addEventListener(type, updateInput, options);
document.addEventListener('visibilitychange', updateInput, options);
viewport.addEventListener('pointerdown', () => viewport.focus(), options);
const connect = async (id?: string, reclaim = false) => {
  if (busy || client.active) return;
  busy = true;
  if (privatePage) { element<HTMLSelectElement>('group-size').disabled = true; element<HTMLSelectElement>('course').disabled = true; }
  create.disabled = join.disabled = rejoin.disabled = roomId.disabled = true;
  const selectedCourse = privatePage ? element<HTMLSelectElement>('course').value : 'road';
  const course = selectedCourse === 'generated' ? 'generated' : selectedCourse === 'railway' ? 'railway' : selectedCourse === 'river' ? 'river' : 'road';
  const capacity = privatePage ? Number(element<HTMLSelectElement>('group-size').value || 2) as GroupSize : 2;
  const seed = privatePage && course === 'generated' && element<HTMLInputElement>('world-seed').value !== '' ? Number(element<HTMLInputElement>('world-seed').value) : undefined;
  try { roomId.value = await (reclaim ? client.rejoin() : seed === undefined ? client.connect(id, capacity, course) : client.connect(id, capacity, course, seed)); if (!privatePage) viewport.focus(); client.probe(); }
  catch (error) { result.textContent = error instanceof Error ? error.message : 'Connection failed'; if(gameShell) element('invite-feedback').textContent = result.textContent; }
  finally { busy = false; if (privatePage) { element<HTMLSelectElement>('group-size').disabled = client.active; element<HTMLSelectElement>('course').disabled = client.active; } rejoin.disabled = client.active || !client.canRejoin; if (!client.active) create.disabled = join.disabled = roomId.disabled = false; }
};
rejoin.disabled = !client.canRejoin;
rejoin.addEventListener('click', () => { void connect(undefined, true); }, options);
create.addEventListener('click', () => { void connect(); }, options);
join.addEventListener('click', () => {
  const id = privatePage ? roomId.value.replace(/[-\s]/g, '').toUpperCase() : roomId.value.trim();
  if (privatePage ? !isPrivateCode(id) : !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) { result.textContent = privatePage ? 'Enter an eight-character room code.' : 'Enter the room ID from the other browser.'; if(gameShell) element('invite-feedback').textContent = result.textContent; return; }
  void connect(id);
}, options);
leave.addEventListener('click', () => { void client.leave().catch((error: unknown) => { result.textContent = String(error); }); }, options);
reset.addEventListener('click', requestReset, options);
if (privatePage && window.location.hash) {
  const invite = window.location.hash.slice(1).toUpperCase();
  if (/^[A-HJ-NP-Z2-9]{8}$/.test(invite)) roomId.value = invite;
}
void renderer.loadGoose().then(() => { if (!disposed) result.textContent = privatePage ? 'Create a private room or join your teammate.' : 'Four characters loaded. Create or join a room.'; })
  .catch(error => { if (!disposed) result.textContent = `${String(error)} · Unavailable characters retain placeholders. Reload to retry.`; });

const draw = (now: number) => {
  if (disposed) return;
  const elapsed = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
  performanceMetrics?.record('frame interval ms', now - lastFrameAt);
  lastFrameAt = now;
  const presentationStart = performanceMetrics ? performance.now() : 0;
  const presented = buffer.sample(now);
  if (presented) {
    const paused = presented.ageMs >= 250 || presented.snapshot.phase !== 'running';
    if (presented.world) renderer.generated.update(presented.world);
    if (presented.railway) renderer.railway.update(presented.railway);
    if (presented.road) renderer.traffic.update(presented.road);
    for (const player of presented.players) {
      const view = renderer.players.get(player.id)!;
      view.setDead((presented.world ?? presented.railway ?? presented.river ?? presented.road)?.dead.includes(player.id) ?? false);
      view.setWater((presented.world?.water ?? presented.river)?.players.find(w => w.id === player.id), (presented.world?.water ?? presented.river)?.exposureLimitSeconds);
    }
    if (presented.chain) renderer.chain.update(presented.chain.segments, presented.chain.segments, 1);
    for (const player of presented.players) renderer.players.get(player.id)!.update(player.position, player.velocity, elapsed, player.grounded, paused);
    renderer.camera.update([...presented.players.map((player) => player.position), ...(presented.chain?.segments.map(p=>p.position) ?? [])], elapsed, snapCamera, presented.world);
    snapCamera = false;
    if (now - lastMetricsAt >= 100) {
      lastMetricsAt = now;
      const snapshot = presented.snapshot;
      if (performanceMetrics && performancePanel) {
        performancePanel.textContent = performanceMetrics.summary() + `
Draw calls ${renderer.renderer.info.render.calls} · triangles ${renderer.renderer.info.render.triangles}
Snapshot age ${presented.ageMs.toFixed(1)} ms · RTT ${rttMs?.toFixed(1) ?? '—'} ms · ${presented.holding ? 'holding latest' : 'interpolating'} · ${snapshot.phase} · tick ${snapshot.tick}
Server (process CPU/RSS; five-second window): ${serverPerformance || 'awaiting diagnostic window'}`;
      }
      metrics.textContent = `You: ${slot ?? 'awaiting slot'} · ${snapshot.phase}${presented.ageMs >= 250 ? ' · snapshots stale' : ''}\n`
        + `${snapshot.chain ? `Chain course ${snapshot.chain.course} · ${snapshot.chain.segments.length} physical spans · ` : ''}Run ${snapshot.runGeneration} · server tick ${snapshot.tick} · snapshot age ${presented.ageMs.toFixed(0)} ms · RTT ${rttMs?.toFixed(1) ?? '—'} ms\n`
        + `${snapshot.road ? carStatus + ' · ' : ''}Render delay ${buffer.delayMs} ms · ${presented.holding ? 'holding latest' : 'interpolating'} · dropped catch-up ${snapshot.droppedSeconds.toFixed(3)} s\n`
        + `Last input event: ${lastInputEvent}\n`
        + snapshot.players.map((player) => `${player.id}: x=${player.position.x.toFixed(2)} z=${player.position.z.toFixed(2)} · consumed input ${player.acknowledgedSequence}`).join('\n');
    }
  }
  performanceMetrics?.record('presentation CPU ms', performance.now() - presentationStart);
  if (presented?.holding) performanceMetrics?.count('held frames');
  const renderStart = performanceMetrics ? performance.now() : 0;
  if (!gameShell?.inMenu || now-lastMenuDraw>=100) { const start=performance.now(); renderer.draw(); lastMenuDraw = now; const info=renderer.renderer.info; gameShell?.recordGameRender({calls:info.render.calls,triangles:info.render.triangles,...info.memory},performance.now()-start); }
  gameShell?.draw(now);
  performanceMetrics?.record('render submission CPU ms', performance.now() - renderStart);
  frame = requestAnimationFrame(draw);
};
frame = requestAnimationFrame(draw);
const dispose = () => {
  if (disposed) return;
  disposed = true;
  events.abort(); clearInterval(inputTimer); clearInterval(probeTimer); cancelAnimationFrame(frame);
  longTasks?.disconnect(); performancePanel?.remove(); lobbyView?.dispose(); nameInput?.dispose(); input.dispose(); sender.clear(); client.dispose(); buffer.clear(); renderer.dispose();
};
window.addEventListener('pagehide', () => { input.clear('pagehide'); client.sendInput(0, 0); client.suspend(); }, options);
if (import.meta.hot) import.meta.hot.dispose(dispose);
