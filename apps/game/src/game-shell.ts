import './game-ui.css';
import { defaultDisplayName, normalizeDisplayName, playerSlots } from '@crossy/protocol';
import type { GroupSize, LobbyMessage, PlayerSlot, SnapshotMessage } from '@crossy/protocol';
import { characterAssets } from './character-assets';
import { canHostStart, cinematicPose, failureNames, failurePresentation, nextCapacity } from './gui-state';
import { MenuPreviews } from './menu-previews';

export type GuiMode = 'online' | 'phones' | 'keyboard';
export type GuiAdapter = { clearInput: () => void; hostStart: () => void; ready: (slot?: PlayerSlot) => void; restart: () => void; leave: () => Promise<void>; name?: (slot: PlayerSlot, value: string) => void };
export let gameShell: GameShell | undefined;
export function mountGameShell(mode: GuiMode): GameShell { return gameShell = new GameShell(mode); }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const put = (id: string, value: string) => { const n = el(id); if (n.textContent !== value) n.textContent = value; };

export class GameShell {
  private adapter: GuiAdapter | undefined;
  private data: LobbyMessage | undefined;
  private slot: PlayerSlot | undefined;
  private connected = false;
  private leaving = false;
  private leaveReturn: string | undefined;
  private latest: SnapshotMessage | undefined;
  private runKey = '';
  private deathAt: number | undefined;
  private deathSlot: PlayerSlot = 'p1';
  private capacity: GroupSize = 2;
  private screen: 'menu' | 'game' | 'cinematic' | 'results' = 'menu';
  private paused = false;
  private skipKey: string | undefined;
  private lastSnapshotAt = 0;
  private active = false;
  private readonly events = new AbortController();
  readonly previews: MenuPreviews;
  private lastMetricAt = 0;
  private lastFrameAt = 0;
  private frameSamples: number[] = [];
  private gameMetric = {calls:0,triangles:0,geometries:0,textures:0,renderCpuMs:0};
  recordGameRender(counters: {calls:number;triangles:number;geometries:number;textures:number}, cpuMs:number): void { this.gameMetric={...counters,renderCpuMs:cpuMs}; }
  private previousFocus: HTMLElement | null = null;
  constructor(readonly mode: GuiMode) {
    document.body.className = 'game-ui';
    el('game-app').innerHTML = `
      <div id="viewport" tabindex="0" aria-label="Crossy Chains game world"><div id="player-labels" aria-hidden="true"></div></div>
      <div class="menu-shade" id="menu-shade"></div>
      <section id="game-menu" class="menu-screen" aria-labelledby="game-title">
        <header class="game-identity"><h1 id="game-title">CROSSY <span>CHAINS</span></h1></header>
        <div class="menu-panel">
          <nav class="mode-bar" aria-label="Multiplayer mode"><button id="mode-local" aria-pressed="${mode !== 'online'}">LOCAL<br>MULTIPLAYER</button><button id="mode-invite" class="invite-tab">${mode === 'online' ? 'ROOM<br>CODE' : 'QR<br>CODE'}</button><button id="mode-online" aria-pressed="${mode === 'online'}">ONLINE<br>MULTIPLAYER</button></nav>
          <div class="setup-line"><label id="local-controls-label">Controls <select id="local-controls"><option value="keyboard">Shared keyboard · 2 players</option><option value="phones">Phone controllers · 2–4 players</option></select></label><span id="room-summary">Choose your team</span><button id="show-invite" class="quiet">${mode === 'online' ? 'Create / join room' : 'Connect phones'}</button></div>
          <div class="character-cards" id="character-cards">${playerSlots.map((slot, index) => `<article id="card-${slot}" class="character-card" ${index > 1 ? 'hidden' : ''} aria-label="Player ${index+1} · ${characterAssets[slot].species}"><div class="card-top"><span>${characterAssets[slot].species}</span><button class="remove-player" data-remove="${slot}" aria-label="Remove player ${index+1}" ${index < 2 ? 'hidden' : ''}>−</button></div><div class="character-preview" data-preview="${slot}" role="img" aria-label="3D ${characterAssets[slot].species}">Loading character…</div><div id="name-${slot}" class="card-name"><label class="local-name">Player ${index+1} name<input data-local-name="${slot}" aria-label="Player ${index+1} name" value="Player ${index+1}" autocomplete="off"></label><span class="remote-name" id="remote-name-${slot}" hidden>Player ${index+1}</span></div><p id="card-status-${slot}" class="card-status">${mode === 'keyboard' ? index === 0 ? 'WASD' : 'Arrow keys' : 'Waiting for player'}</p><button id="card-ready-${slot}" class="ready-card" ${mode !== 'keyboard' ? 'hidden' : ''}>Ready</button></article>`).join('')}
          <button id="add-player" class="add-player"><span aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14"/></svg></span><strong>ADD PLAYER</strong></button></div>
          <div class="start-area"><button id="primary-start" class="primary" disabled>START</button><p id="start-reason">Choose Ready on both cards</p></div>
          <div class="menu-bottom"><span id="connection-note">${mode === 'online' ? 'Private rooms · 2–4 players' : mode === 'phones' ? 'One screen · one phone each' : 'One screen · shared keyboard'}</span><div><button id="lobby-leave" class="text-button" hidden>Leave room</button><button id="menu-controls" class="text-button">How to play</button><button id="menu-advanced" class="text-button">Advanced</button></div></div>
          <p id="menu-feedback" role="status"></p>
        </div>
      </section>
      <aside id="game-hud" hidden aria-label="Gameplay information"><div class="hud-score"><small>TEAM</small><strong id="hud-score">0 m</strong></div><p id="hud-state" role="status"></p><button id="open-pause" aria-label="Open pause menu">Ⅱ <span>MENU</span></button></aside>
      <dialog id="invite-dialog" class="ui-dialog"><button class="dialog-close" data-close aria-label="Close invitations">×</button><h2 id="invite-title">${mode === 'online' ? 'PLAY TOGETHER' : 'SCAN TO JOIN'}</h2>
        <div id="online-invite" ${mode !== 'online' ? 'hidden' : ''}><div id="room-entry"><p>Play online with friends.</p><section class="room-create"><button id="create">CREATE ROOM</button><p>Create a private room and invite your friends.</p></section><div class="room-divider">OR</div><section class="room-join"><h3>JOIN A ROOM</h3><label>Room code<input id="room-id" maxlength="16" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDEFGH"></label><button id="join">JOIN ROOM</button></section></div><section id="room-details" hidden><p class="room-ready">YOUR ROOM IS READY</p><label>ROOM CODE</label><div class="room-code-row"><strong id="invite-code"></strong><button id="copy-code">Copy code</button></div><p>Share your code or link with friends.</p><button id="invite-leave" class="text-button">Leave room</button></section></div>
        <div id="phone-invite" ${mode !== 'phones' ? 'hidden' : ''}><button id="create-couch">Create phone room</button><div id="qr" aria-label="Controller invitation QR"></div><p id="invite-hint">Create a room to connect your phones.</p><strong>Room <span id="room-code">—</span></strong></div>
        <p id="keyboard-invite" ${mode !== 'keyboard' ? 'hidden' : ''}>Playing on one keyboard? Use WASD and arrow keys. For phones, switch to Phone controllers first.</p>
        <div id="room-share" ${mode === 'online' ? 'hidden' : ''}><label id="invite-link-label">Invite link<input id="invite-link" readonly aria-label="Invite link"></label><button id="copy-invite" disabled>Copy invite link</button></div><button id="rejoin" disabled>Rejoin previous room</button><button id="invite-close" data-close class="quiet">Close</button><p id="invite-feedback" role="status"></p><p id="status" role="status">${mode === 'online' ? 'Create a private room or join a friend.' : 'Your team, on one screen.'}</p>
      </dialog>
      <dialog id="leave-dialog" class="ui-dialog" aria-labelledby="leave-title"><h2 id="leave-title">LEAVE GAME?</h2><p>Are you sure you want to leave?</p><p id="leave-consequence"></p><p id="leave-feedback" role="status"></p><div class="confirmation-actions"><button id="leave-cancel" autofocus>Cancel</button><button id="leave-confirm" class="danger">Leave Game</button></div></dialog>
      <dialog id="mode-warning" class="ui-dialog" aria-labelledby="mode-warning-title"><h2 id="mode-warning-title">STAYING IN YOUR ROOM</h2><p class="mode-warning-text">⚠ Leave your current room before switching modes.</p><div class="confirmation-actions"><button id="mode-stay" autofocus>Stay in Room</button><button id="mode-leave">Leave Room</button></div></dialog>
      <dialog id="keyboard-limit" class="ui-dialog" aria-labelledby="keyboard-limit-title"><h2 id="keyboard-limit-title">MORE PLAYERS?</h2><p>Switch to phone controllers to add more players.</p><button id="keyboard-limit-ok" autofocus>OK</button></dialog>
      <dialog id="pause-dialog" class="ui-dialog"><button class="dialog-close" data-close aria-label="Close pause menu">×</button><p class="kicker">CROSSY CHAINS</p><h2>TAKE A BREATHER</h2><p id="pause-explanation">${mode === 'keyboard' ? 'Your local game is paused.' : mode === 'phones' ? 'The shared game continues. Keep your phones active. Leaving this shared display ends the session.' : 'Your controls are neutral. The shared game continues; this menu does not pause other players.'}</p><div class="dialog-actions"><button id="resume" class="primary">RESUME</button><button id="pause-controls">CONTROLS</button><button id="settings">SETTINGS</button><button id="pause-restart">RESTART VOTE</button><button id="pause-invite">ROOM / INVITE</button><button id="pause-leave" class="danger">LEAVE GAME</button></div></dialog>
      <dialog id="help-dialog" class="ui-dialog"><button class="dialog-close" data-close aria-label="Close controls">×</button><h2>STICK TOGETHER</h2><p>Move with WASD. On a shared keyboard, Player 2 uses the arrow keys. On phones, use the touch stick.</p><p>Dodge traffic. Watch the railway lamps. Pull your teammates out of water and recover fully ashore.</p><p>One failure ends the team attempt. Open the menu with Escape. Press R to request a team restart.</p></dialog>
      <dialog id="settings-dialog" class="ui-dialog"><button class="dialog-close" data-close aria-label="Close settings">×</button><h2>SETTINGS</h2><p>Motion follows your device’s Reduce Motion preference.</p><p>Audio controls will be available when game audio is added.</p><button id="settings-advanced">Advanced / diagnostics</button><button id="fullscreen">Toggle fullscreen</button></dialog>
      <dialog id="advanced-dialog" class="ui-dialog"><button class="dialog-close" data-close aria-label="Close advanced controls">×</button><h2>ADVANCED</h2><label>Team size<select id="group-size"><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select></label><label>Course<select id="course"><option value="generated" selected>Endless · Generated World</option><option value="road">Road test</option><option value="river">River test</option><option value="railway">Railway test</option></select></label><label>World seed<input id="world-seed" type="number" min="0" max="4294967295" step="1" placeholder="Random"></label><pre id="gui-metrics">Rendering measurements pending.</pre><details id="diagnostics"><summary>Connection details</summary><pre id="metrics">Waiting for a room.</pre><p>Server: <code id="endpoint"></code></p></details><p><a href="/playground.html">Local chain playground</a> · <a href="/multiplayer.html?chain=road">Multiplayer development</a> · <a href="/network.html">Transport diagnostics</a></p></dialog>
      <section id="cinematic-screen" hidden aria-label="Team failure animation"><div id="cinematic-model"></div><button id="skip-cinematic">Skip · Enter / Space</button></section>
      <section id="results-screen" hidden class="results-screen" aria-labelledby="results-title"><div class="results-panel"><p class="kicker">ONE CHAIN. STILL ONE TEAM.</p><h2 id="results-title">GAME OVER</h2><div id="results-model" role="img" aria-label="Affected character"></div><h3 id="failure-name"></h3><p id="failure-cause"></p><p class="results-score">TEAM SCORE <strong id="final-score">0 m</strong></p><button id="play-again" class="primary">PLAY AGAIN</button><p id="vote-count">0 / 2 READY</p><button id="results-leave">BACK TO MAIN MENU</button><small class="leave-hint">${mode === 'phones' ? 'Ends this shared session' : mode === 'keyboard' ? 'Ends this local run' : 'Leaves your room'}</small></div></section>
      <div class="legacy-state" hidden><section id="lobby-panel"><h2 id="lobby-title"></h2><p id="member-p1"></p><p id="member-p2"></p><p id="member-p3"></p><p id="member-p4"></p><p id="lobby-hint"></p><button id="ready">Ready</button><button id="start">Start</button><button id="reset">Restart</button><button id="restart">Restart</button><button id="cancel-restart">Cancel restart</button><p id="lobby-feedback"></p><ul id="seats"></ul></section><button id="leave">Leave room</button><p id="result"></p></div><div id="own-name" hidden></div><canvas id="preview-canvas" aria-hidden="true"></canvas>`;
    this.previews = new MenuPreviews(el<HTMLCanvasElement>('preview-canvas'));
    const query = new URLSearchParams(location.search), requested = Number(query.get('players'));
    if (mode !== 'keyboard' && (requested === 3 || requested === 4)) this.capacity = requested;
    el<HTMLSelectElement>('group-size').value = String(this.capacity);
    el<HTMLSelectElement>('local-controls').value = mode === 'phones' ? 'phones' : 'keyboard';
    el('local-controls-label').hidden = mode === 'online';
    const options = { signal: this.events.signal };
    const click = (id: string, fn: () => void) => el(id).addEventListener('click', fn, options);
    const switchTo = (next: GuiMode) => { if (this.active) { el<HTMLSelectElement>('local-controls').value = mode === 'phones' ? 'phones' : 'keyboard'; this.openDialog('mode-warning'); return; } location.href = `${next === 'online' ? '/play.html' : next === 'phones' ? '/display.html' : '/local.html'}?players=${this.capacity}`; };
    click('mode-local', () => { if (mode === 'online') switchTo('keyboard'); });
    click('mode-online', () => { if (mode !== 'online') switchTo('online'); });
    el('local-controls').addEventListener('change', () => switchTo(el<HTMLSelectElement>('local-controls').value as GuiMode), options);
    click('mode-invite', () => this.openDialog('invite-dialog'));
    click('show-invite', () => this.openDialog('invite-dialog'));
    click('add-player', () => { if (mode === 'keyboard') this.openDialog('keyboard-limit'); else this.changeCapacity(1); });
    click('keyboard-limit-ok', () => this.closeDialogs());
    click('mode-stay', () => this.closeDialogs()); click('mode-leave', () => this.confirmLeave());
    click('leave-cancel', () => this.cancelLeave()); click('leave-confirm', () => { void this.leave(); });
    click('invite-leave', () => this.confirmLeave());
    click('copy-code', () => { void navigator.clipboard.writeText(this.data?.code ?? '').then(() => put('invite-feedback','Room code copied')).catch(() => put('invite-feedback','Select the room code and copy it manually.')); });
    for (const [index, slot] of playerSlots.entries()) {
      el(`card-${slot}`).querySelector('[data-remove]')!.addEventListener('click', () => this.changeCapacity(-1), options);
      click(`card-ready-${slot}`, () => this.adapter?.ready(slot));
      const field = el(`card-${slot}`).querySelector<HTMLInputElement>('input')!;
      field.addEventListener('change', () => { const value = normalizeDisplayName(field.value); field.setCustomValidity(value === undefined ? 'Use up to 16 characters without markup or controls.' : ''); if (value === undefined) field.reportValidity(); else this.adapter?.name?.(slot, value || defaultDisplayName(slot)); }, options);
      field.addEventListener('input', () => field.setCustomValidity(''), options);
      if (mode !== 'keyboard') { field.parentElement!.hidden = true; el(`remote-name-${slot}`).hidden = false; }
      el(`card-${slot}`).dataset.index = String(index);
    }
    el('group-size').addEventListener('change', () => { if (!this.active) { this.capacity = mode === 'keyboard' ? 2 : Number(el<HTMLSelectElement>('group-size').value) as GroupSize; el<HTMLSelectElement>('group-size').value = String(this.capacity); this.cards(); } }, options);
    click('primary-start', () => { if (mode === 'keyboard' && this.capacity > 2) { switchTo('phones'); return; } this.adapter?.hostStart(); });
    click('settings-advanced', () => this.openDialog('advanced-dialog'));
    if (mode === 'online') {
      const fullscreen = el<HTMLButtonElement>('fullscreen');
      fullscreen.disabled = !document.fullscreenEnabled;
      click('fullscreen', () => {
        const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        void request.catch(() => { fullscreen.textContent = 'Fullscreen unavailable'; });
      });
    }
    click('menu-controls', () => this.openDialog('help-dialog')); click('menu-advanced', () => this.openDialog('advanced-dialog'));
    click('open-pause', () => this.openDialog('pause-dialog')); click('resume', () => this.closeDialogs());
    click('pause-controls', () => this.openDialog('help-dialog')); click('settings', () => this.openDialog('settings-dialog'));
    click('pause-restart', () => { this.adapter?.restart(); this.closeDialogs(); }); click('pause-invite', () => this.openDialog('invite-dialog'));
    for (const id of ['pause-leave','results-leave','lobby-leave']) click(id, () => this.confirmLeave());
    click('play-again', () => this.adapter?.restart()); click('skip-cinematic', () => this.finishCinematic());
    click('create-couch', () => el<HTMLButtonElement>('create').click());
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
      for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => this.closeDialogs(), options);
      dialog.addEventListener('cancel', e => { e.preventDefault(); if (dialog.id === 'leave-dialog') this.cancelLeave(); else this.closeDialogs(); }, options);
    }
    // Capture phase consumes a skip gesture before KeyboardInput or underlying actions.
    window.addEventListener('keyup', e => { if(this.skipKey===e.code){e.preventDefault();e.stopImmediatePropagation();this.skipKey=undefined;} },{...options,capture:true});
    window.addEventListener('keydown', e => {
      if(this.skipKey===e.code){e.preventDefault();e.stopImmediatePropagation();return;}
      if (this.screen === 'cinematic' && ['Enter','Space','Escape'].includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { this.skipKey=e.code; this.finishCinematic(); } return; }
      if(e.code==='F2' && !e.repeat){e.preventDefault();e.stopImmediatePropagation();this.openDialog('advanced-dialog');return;}
      if (e.code === 'Escape' && !e.repeat && (this.screen === 'game' || this.paused)) { e.preventDefault(); e.stopImmediatePropagation(); if (this.paused) { if (el<HTMLDialogElement>('leave-dialog').open) this.cancelLeave(); else this.closeDialogs(); } else this.openDialog('pause-dialog'); }
    }, { ...options, capture: true });
    this.cards();
  }
  get inputBlocked(): boolean { return this.paused || this.screen !== 'game'; }
  get inMenu(): boolean { return this.screen === 'menu'; }
  get desiredCapacity(): GroupSize { return this.capacity; }
  bind(adapter: GuiAdapter): void { this.adapter = adapter; }
  connection(connected: boolean, active: boolean): void {
    this.connected = connected; this.active = active;
    if(!connected && active) put('hud-state','RECONNECTING · your slot is reserved');
    if (!active) { el('own-name').hidden = true; for(const s of playerSlots) el(`remote-name-${s}`).hidden = this.mode === 'keyboard'; this.data = undefined; this.latest = undefined; this.runKey = ''; this.deathAt = undefined; this.setScreen('menu'); }
    this.cards();
  }
  lobby(data: LobbyMessage, slot?: PlayerSlot): void {
    const newRoom = !this.data;
    this.data = data; this.slot = slot; this.capacity = data.capacity; this.active = this.mode === 'keyboard' ? data.stage === 'playing' : true;
    el<HTMLSelectElement>('group-size').value = String(data.capacity);
    if (this.mode === 'online') for (const s of playerSlots) el(`remote-name-${s}`).hidden = s === slot;
    if (slot && this.mode === 'online') { if (el('own-name').parentElement !== el(`name-${slot}`)) el(`name-${slot}`).append(el('own-name')); el('own-name').hidden = false; el(`remote-name-${slot}`).hidden = true; }
    this.cards();
    if (newRoom && this.mode === 'online' && el<HTMLDialogElement>('invite-dialog').open) el('copy-code').focus();
  }
  private changeCapacity(direction: 1 | -1): void { this.capacity = nextCapacity(this.capacity,direction,this.active); el<HTMLSelectElement>('group-size').value = String(this.capacity); this.cards(); }
  private cards(): void {
    if (this.mode === 'online') {
      el('room-entry').hidden = this.active; el('room-details').hidden = !this.data; el('room-share').hidden = !this.data;
      put('invite-title', this.data ? 'YOUR ROOM' : this.active ? 'RECONNECTING' : 'PLAY TOGETHER');
      el('rejoin').hidden = this.active;
    }
    const data = this.data, own = data?.players.find(p => p.slot === this.slot);
    for(const id of ['group-size','course','world-seed']) (el(id) as HTMLInputElement | HTMLSelectElement).disabled=this.active;
    for (const [i, slot] of playerSlots.entries()) {
      const card = el(`card-${slot}`), member = data?.players.find(p => p.slot === slot);
      card.hidden = i >= this.capacity;
      const remove = card.querySelector<HTMLButtonElement>('[data-remove]')!;
      remove.hidden = i < 2 || i !== this.capacity-1; remove.disabled = this.active; remove.title = this.active ? 'Room capacity is fixed. Leave before configuring a new team.' : 'Remove the last optional slot';
      card.dataset.ready = String(!!member?.ready);
      const localName = card.querySelector<HTMLInputElement>('input')!;
      if (this.mode === 'keyboard') localName.disabled = data?.stage === 'playing';
      const name = member?.displayName || localName.value || defaultDisplayName(slot); put(`remote-name-${slot}`,name);
      const state = !member ? this.mode === 'keyboard' && i < 2 ? i === 0 ? 'WASD · not ready' : 'Arrow keys · not ready' : 'Waiting for player'
        : !member.connected ? 'Disconnected · slot reserved' : data?.stage === 'playing' ? member.restartRequested ? 'Replay vote sent' : 'Connected' : member.ready ? 'READY' : 'Not ready';
      put(`card-status-${slot}`,`${data?.host === slot ? 'HOST · ' : ''}${this.mode==='online'&&data?.host===slot&&data?.stage==='lobby'&&member?.connected&&!member.ready?'Ready on Start':state}`);
      const ready = el<HTMLButtonElement>(`card-ready-${slot}`);
      ready.hidden = this.mode === 'keyboard' ? i > 1 || data?.stage === 'playing' : this.mode !== 'online' || slot !== this.slot || (data?.host === slot && !member?.ready) || data?.stage !== 'lobby';
      ready.disabled = this.mode === 'online' && !this.connected;
      put(`card-ready-${slot}`,member?.ready ? 'NOT READY' : 'READY');
    }
    el('lobby-leave').hidden = !this.active;
    el<HTMLButtonElement>('create-couch').disabled = this.active;
    el('add-player').hidden = this.capacity >= 4; el<HTMLButtonElement>('add-player').disabled = this.active;
    put('room-summary', this.mode === 'keyboard' ? `${this.capacity} PLAYERS · SHARED KEYBOARD` : data ? `ROOM ${data.code} · ${data.players.filter(p=>p.connected).length}/${data.capacity} connected` : `${this.capacity} PLAYER TEAM`);
    const start = el<HTMLButtonElement>('primary-start');
    if (this.mode === 'keyboard') {
      start.disabled = this.capacity <= 2 && (!data || data.players.length !== 2 || !data.players.every(p=>p.ready)); put('primary-start',this.capacity > 2 ? 'USE PHONE CONTROLLERS' : 'START');
      put('start-reason', this.capacity > 2 ? 'Three or four local players each need a phone.' : start.disabled ? 'Choose Ready on both cards' : 'WASD + arrow keys · ready to cross');
    } else if (this.mode === 'phones') {
      start.disabled = !this.connected || data?.stage !== 'lobby' || data.players.length !== data.capacity || !data.players.every(p=>p.connected&&p.ready); put('primary-start','START');
      put('start-reason', !data ? 'Connect your team’s phones' : start.disabled ? `${data.players.filter(p=>p.connected&&p.ready).length}/${data.capacity} ready · choose Ready on each phone` : 'Everyone is ready!');
    } else {
      start.hidden = !!data && data.host !== this.slot; start.disabled = !this.connected || !canHostStart(data,this.slot); put('primary-start','START');
      put('start-reason', !data ? 'Create or join a private room' : data.host !== this.slot ? own?.ready ? 'Ready · waiting for the host' : 'Choose Ready on your card' : start.disabled ? 'Waiting for every teammate to connect and choose Ready' : 'Teammates ready · Start confirms your readiness');
    }
    if (data) {
      const votes = data.players.filter(p=>p.restartRequested).length;
      put('vote-count',this.mode==='keyboard' ? 'Shared keyboard · restart both players' : `${votes} / ${data.capacity} READY${this.mode === 'phones' ? ' · vote on each phone' : ''}`);
      const terminal = this.latest?.phase === 'ended' || this.latest?.phase === 'fault';
      const paired = data.players.length===data.capacity && data.players.every(p=>p.connected);
      el<HTMLButtonElement>('play-again').disabled = this.mode !== 'keyboard' && (!this.connected || !paired || (this.mode === 'phones' && (!!this.latest?.world || !terminal)) || (this.mode === 'online' && !this.latest?.world && data.host !== this.slot));
      put('play-again',own?.restartRequested ? 'VOTE SENT' : this.mode === 'phones' && this.latest?.world ? 'VOTE ON YOUR PHONES' : 'PLAY AGAIN');
      el<HTMLButtonElement>('pause-restart').disabled = !paired || this.mode === 'phones';
    }
  }
  snapshot(snapshot: SnapshotMessage, now = performance.now()): void {
    this.latest = snapshot; this.lastSnapshotAt=performance.now();
    put('hud-score',`${(snapshot.run?.distance ?? Math.max(0, Math.min(...snapshot.players.map(p=>p.position.z)))).toFixed(0)} m`);
    put('hud-state', snapshot.phase === 'paused' ? 'TEAM PAUSED · waiting for a safe connection' : snapshot.phase === 'waiting' ? 'Waiting for the team' : '');
    const key = `${snapshot.runGeneration}`;
    if (key !== this.runKey) { this.runKey = key; this.deathAt = undefined; if (snapshot.phase !== 'waiting') this.closeDialogs(false); }
    if (snapshot.phase === 'running' || snapshot.phase === 'paused') {
      if (this.screen !== 'game') { this.setScreen('game'); this.closeDialogs(false); el('viewport').focus(); }
    } else if (snapshot.phase === 'waiting') { this.deathAt = undefined; this.setScreen('menu'); }
    else if ((snapshot.phase === 'ended' || snapshot.phase === 'fault') && this.deathAt === undefined) {
      const failure = failurePresentation(snapshot); this.deathAt = now; this.deathSlot = failure.slots[0] ?? 'p1';
      this.adapter?.clearInput(); this.closeDialogs(false);
      el('results-model').hidden = !failure.slots.length;
      put('results-title', failure.failed ? 'GAME OVER' : 'TEAM CROSSING!'); put('failure-name',failureNames(failure.slots,this.data)); put('failure-cause',failure.cause + (failure.slots.length ? '.' : ''));
      put('final-score',`${(snapshot.run?.distance ?? Math.max(0, Math.min(...snapshot.players.map(p=>p.position.z)))).toFixed(1)} m`);
      this.setScreen(failure.failed && failure.slots.length ? 'cinematic' : 'results');
      el('skip-cinematic').focus();
    }
    this.cards();
  }
  private setScreen(screen: typeof this.screen): void {
    this.screen = screen;
    el('game-menu').hidden = screen !== 'menu'; el('game-hud').hidden = screen !== 'game';
    el('cinematic-screen').hidden = screen !== 'cinematic'; el('results-screen').hidden = screen !== 'results';
    el('menu-shade').hidden = screen === 'game';
    el('preview-canvas').hidden = screen === 'game';
    document.body.dataset.screen = screen;
  }
  private finishCinematic(): void { if(this.screen !== 'cinematic') return; this.setScreen('results'); el('play-again').focus(); }
  private openDialog(id: string): void {
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.closeDialogs(false); this.paused = true; this.adapter?.clearInput();
    el<HTMLDialogElement>(id).showModal();
  }
  private closeDialogs(restore = true): void {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
    this.paused = false; this.adapter?.clearInput();
    if (restore) { if (this.screen === 'game') el('viewport').focus(); else this.previousFocus?.focus(); }
  }
  private confirmLeave(): void {
    this.leaveReturn = document.querySelector<HTMLDialogElement>('dialog[open]')?.id;
    put('leave-consequence', this.mode === 'phones' ? 'Leaving this shared display ends the controller session.' : this.mode === 'keyboard' ? 'This ends the local run for both players.' : 'You leave your slot. The team returns to the lobby; a departing host transfers ownership to a remaining player.');
    put('leave-feedback',''); this.openDialog('leave-dialog'); el('leave-cancel').focus();
  }
  private cancelLeave(): void {
    if (this.leaving) return;
    if (this.leaveReturn) this.openDialog(this.leaveReturn); else this.closeDialogs();
    this.leaveReturn = undefined;
  }
  private async leave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true; el<HTMLButtonElement>('leave-confirm').disabled = true;
    el<HTMLButtonElement>('leave-cancel').disabled = true;
    put('menu-feedback','Leaving ends your participation in this room.');
    this.adapter?.clearInput();
    try { await this.adapter?.leave(); this.closeDialogs(false); this.active = false; this.data = undefined; this.latest = undefined; this.runKey = ''; this.deathAt = undefined; el('own-name').hidden = true; this.setScreen('menu'); this.cards(); el('mode-local').focus(); }
    catch { put('leave-feedback','Could not leave cleanly. Please try again.'); }
    finally { this.leaving = false; el<HTMLButtonElement>('leave-confirm').disabled = false; el<HTMLButtonElement>('leave-cancel').disabled = false; }
  }
  draw(now: number): void {
    if(this.lastFrameAt && !document.hidden){this.frameSamples.push(now-this.lastFrameAt);if(this.frameSamples.length>120)this.frameSamples.shift();} this.lastFrameAt=now;
    if(now-this.lastMetricAt>1000){this.lastMetricAt=now;const sorted=[...this.frameSamples].sort((a,b)=>a-b), p95=sorted[Math.floor(sorted.length*.95)]??0;put('gui-metrics',JSON.stringify({screen:this.screen,viewport:[innerWidth,innerHeight],frameSamples:sorted.length,frameP50Ms:Number((sorted[Math.floor(sorted.length*.5)]??0).toFixed(2)),frameP95Ms:Number(p95.toFixed(2)),frameP99Ms:Number((sorted[Math.floor(sorted.length*.99)]??0).toFixed(2)),fps:sorted.length?Number((1000/(sorted.reduce((a,b)=>a+b,0)/sorted.length)).toFixed(1)):0,preview:this.previews.metrics(),game:this.gameMetric,canvases:document.querySelectorAll('canvas').length},null,2));}
    if(this.screen==='game' && this.connected && performance.now()-this.lastSnapshotAt>=250)put('hud-state','WAITING FOR FRESH UPDATES · controls are neutral');
    if (this.screen === 'game' || document.hidden) return;
    let targets: {slot:PlayerSlot;element:HTMLElement;cinematicSeconds?:number}[] = [];
    if (this.screen === 'menu' && !this.paused) targets = playerSlots.slice(0,this.capacity).map(slot=>({slot,element:document.querySelector<HTMLElement>(`[data-preview="${slot}"]`)!}));
    if (this.screen === 'cinematic') {
      const seconds = (now-this.deathAt!)/1000;
      if (cinematicPose(seconds,matchMedia('(prefers-reduced-motion: reduce)').matches).done) this.finishCinematic();
      else targets = [{slot:this.deathSlot,element:el('cinematic-model'),cinematicSeconds:seconds}];
    }
    if (this.screen === 'results' && !el('results-model').hidden) targets = [{slot:this.deathSlot,element:el('results-model')}];
    el('preview-canvas').hidden = !targets.length; this.previews.draw(now,targets);
    // Surface existing transport/asset errors in the new menu without exposing diagnostic dumps.
    if (this.screen === 'menu') { const result=el('result').textContent ?? ''; if (/failed|unavailable|invalid|enter the|could not|error/i.test(result)) put('menu-feedback',result); }
  }
  dispose(): void { this.events.abort(); this.closeDialogs(false); this.previews.dispose(); }
}
