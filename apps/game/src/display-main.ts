import { gameShell } from './game-shell';
import { setMenuScene } from './menu-scene';
import { reachablePhoneOrigin } from './gui-state';
import { NamedFeedback } from './named-feedback';
const namedFeedback = new NamedFeedback();
import { generatedFeedback } from './generated-feedback';
import { railwayFeedback } from './railway-feedback';
import { waterFeedback } from './water-feedback';
if (!gameShell) await import('./couch.css');
import { CouchDiagnostics, pauseCause } from './couch-diagnostics';
const safetyDiagnostics = new CouchDiagnostics();
import type { GroupSize } from '@crossy/protocol';
import { TransportTestClient } from './network-client';
import { readTransportEndpoint } from './network-endpoint';
import { CouchLobbyView, element, setText } from './couch-ui';
import { controllerJoinLink, controllerQr } from './couch-invite';
import { SharedScene } from './shared-scene';
import { PerformanceMetrics, formatServerPerformance } from './performance-metrics';

const endpoint = readTransportEndpoint(import.meta.env.VITE_SERVER_URL, location.protocol === 'https:');
if(gameShell) element('endpoint').textContent=endpoint;
const scene = new SharedScene(element('viewport'), element('player-labels'));
if (gameShell) setMenuScene(scene.renderer);
const view = new CouchLobbyView(true, action => client.lobbyAction(action));
const performanceMetrics = new URLSearchParams(location.search).get('diagnostics') === '1' ? new PerformanceMetrics() : undefined;
element('diagnostics').hidden = !performanceMetrics;
let busy = false, disposed = false, frame = 0, previousFrame = performance.now(), metricsAt = 0, serverMetrics = '', inviteCode = '';
function buttons(): void {
  element<HTMLButtonElement>('create').disabled = busy || client.active;
  element<HTMLSelectElement>('group-size').disabled = busy || client.active;
  element<HTMLSelectElement>('course').disabled = busy || client.active;
  element<HTMLButtonElement>('rejoin').disabled = busy || client.active || !client.canRejoin;
  element<HTMLButtonElement>('leave').disabled = !client.active;
}
const client = new TransportTestClient(endpoint, {
  state: () => undefined,
  health: message => safetyDiagnostics.receive(message),
  status: (message, connected) => {
    setText(element('status'), message); view.connection(connected); gameShell?.connection(connected,client.active); buttons();
    if (!connected) {
      scene.clear(); if (gameShell && !client.active) setMenuScene(scene.renderer); inviteCode = ''; element('qr').replaceChildren(); element<HTMLInputElement>('invite-link').value = '';
      element<HTMLButtonElement>('copy-invite').disabled = true;
    }
  },
  displayWelcome: () => client.displayHeartbeat(!document.hidden),
  lobby: message => { namedFeedback.update(message);
    view.update(message); gameShell?.lobby(message); scene.renderer.setNames(message);
    if (inviteCode === message.code) return; inviteCode = message.code;
    const link = controllerJoinLink(location.origin, message.code, safetyDiagnostics.enabled);
    element<HTMLInputElement>('invite-link').value = link; element('qr').innerHTML = reachablePhoneOrigin(location.origin,endpoint) ? controllerQr(link) : '';
    element<HTMLButtonElement>('copy-invite').disabled = false;
    element('invite-hint').textContent = !reachablePhoneOrigin(location.origin,endpoint)
      ? 'Phones cannot reach this loopback address. Open the game using the Mac’s LAN address and start the backend with that LAN address; see README.md. No misleading QR code is shown.' : 'Scan with each phone camera. Join this room, then choose Ready.';
  },
  result: message => { setText(element('result'), message); },
  lobbyRejected: reason => { element('result').textContent = `Action unavailable (${reason}). Wait for every phone to be ready/connected.`; },
  snapshot: snapshot => {
    if (!scene.push(snapshot, performance.now())) return; view.gamePhase(snapshot.phase, !!snapshot.world); gameShell?.snapshot(snapshot);
    setText(element('result'), snapshot.world ? namedFeedback.format(generatedFeedback(snapshot.world, snapshot.phase, snapshot.run)) : snapshot.railway ? namedFeedback.format(railwayFeedback(snapshot.railway)) + (snapshot.phase === 'paused' ? ' · Team paused safely.' : '') : snapshot.river ? namedFeedback.format(waterFeedback(snapshot.river)) + (snapshot.phase === 'paused' ? ' · Team paused safely.' : '') : snapshot.road?.outcome === 'failed' ? `Team failed · ${namedFeedback.format(snapshot.road.dead.join(', '))} hit by traffic. Restart together.`
      : snapshot.road?.outcome === 'cleared' ? 'Everyone made it! Road crossed together.'
      : snapshot.phase === 'waiting' ? 'Scan, join and choose Ready on every phone. Then start the team.'
      : snapshot.phase === 'fault' ? 'Physics safety pause. Restart the complete team.'
      : snapshot.phase === 'paused' ? `Team paused safely · waiting for controllers or display connection. ${pauseCause(safetyDiagnostics.health)}`
      : 'Cross all three roads together. Rest on the green median. Everyone must reach the far line.');
  },
  performance: performanceMetrics ? message => { serverMetrics = formatServerPerformance(message); } : undefined,
}, undefined, true, 'display');
gameShell?.bind({clearInput: () => undefined, hostStart: () => client.lobbyAction('start'), ready: () => undefined, restart: () => client.lobbyAction('restart'), leave: () => client.leave()});
const events = new AbortController(), options = { signal: events.signal };
const connect = async (reclaim = false) => {
  busy = true; buttons();
  const selectedCourse = element<HTMLSelectElement>('course').value;
  const course = selectedCourse === 'generated' ? 'generated' : selectedCourse === 'railway' ? 'railway' : selectedCourse === 'river' ? 'river' : 'road';
  const capacity = Number(element<HTMLSelectElement>('group-size').value) as GroupSize;
  const seed = course === 'generated' && element<HTMLInputElement>('world-seed').value !== '' ? Number(element<HTMLInputElement>('world-seed').value) : undefined;
  try { await (reclaim ? client.rejoin() : seed === undefined ? client.connect(undefined, capacity, course) : client.connect(undefined, capacity, course, seed)); }
  catch (error) { element('result').textContent = error instanceof Error ? error.message : 'Connection failed'; }
  finally { busy = false; buttons(); }
};
element('create').addEventListener('click', () => { void connect(); }, options);
element('rejoin').addEventListener('click', () => { void connect(true); }, options);
element('leave').addEventListener('click', () => { void client.leave().catch(() => undefined); }, options);
element('copy-invite').addEventListener('click', () => {
  const link = element<HTMLInputElement>('invite-link');
  void navigator.clipboard?.writeText(link.value).then(() => { element('invite-hint').textContent = 'Join link copied.'; }).catch(() => { link.focus(); link.select(); });
  if (!navigator.clipboard) { link.focus(); link.select(); element('invite-hint').textContent = 'Select and copy this link.'; }
}, options);
element('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => { element('result').textContent = 'Use your browser’s full-screen command.'; });
}, options);
let lastMenuDraw = 0;
const heartbeat = setInterval(() => client.displayHeartbeat(!document.hidden), 1000);
document.addEventListener('visibilitychange', () => client.displayHeartbeat(!document.hidden), options);
window.addEventListener('pagehide', () => { client.displayHeartbeat(false); client.suspend(); }, options);
window.addEventListener('pageshow', event => { if (event.persisted && !client.active && client.canRejoin) void connect(true); }, options);
function draw(now: number): void {
  if (disposed) return;
  performanceMetrics?.record('frame interval ms', now - previousFrame);
  if (!gameShell?.inMenu || now-lastMenuDraw>=100) { const start=performance.now(); scene.draw(now, Math.min(.1, Math.max(0, (now - previousFrame) / 1000))); lastMenuDraw = now; const info=scene.renderer.renderer.info; gameShell?.recordGameRender({calls:info.render.calls,triangles:info.render.triangles,...info.memory},performance.now()-start); } previousFrame = now;
  gameShell?.draw(now);
  if (performanceMetrics && now - metricsAt > 500) {
    metricsAt = now; const latest = scene.buffer.latest;
    element('metrics').textContent = `${performanceMetrics.summary()}\n${latest?.players.length ?? 0} players · ${latest?.chain?.segments.length ?? 0} spans · ${latest?.phase ?? 'offline'} · tick ${latest?.tick ?? 0}\nAge ${scene.buffer.ageMs(now).toFixed(0)} ms · draws ${scene.renderer.renderer.info.render.calls}\n${latest?.players.map(p => `${p.id}: X ${p.position.x.toFixed(2)} Z ${p.position.z.toFixed(2)} ack ${p.acknowledgedSequence}`).join('\n') ?? ''}\n${serverMetrics}`;
  }
  frame = requestAnimationFrame(draw);
}
buttons(); frame = requestAnimationFrame(draw);
const dispose = () => { if (disposed) return; disposed = true; events.abort(); clearInterval(heartbeat); cancelAnimationFrame(frame); view.dispose(); client.dispose(); scene.dispose(); };
if (import.meta.hot) import.meta.hot.dispose(dispose);
