import { playerSlots } from '@crossy/protocol';
import type { LobbyAction, LobbyMessage, LobbyRejectionReason, PlayerSlot, RoomPhase } from '@crossy/protocol';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing lobby element: ${id}`); return node as T;
}
function text(node: HTMLElement, value: string): void {
  // Retain button text nodes between pointer-down/up (Safari can cancel a click if replaced).
  if (node.textContent !== value) node.textContent = value;
}
const rejectionText: Record<LobbyRejectionReason, string> = {
  'not-host': 'Only the host can do that.', 'not-ready': 'All players must be ready first.',
  'not-in-lobby': 'The run has already started.', 'not-playing': 'Start the run first.',
  'need-two-players': 'Wait for every configured player to be connected.', 'stale-command': 'The room changed. Try again with its latest state.',
  'invalid-command': 'That action is unavailable.', 'command-rate': 'Please wait a moment before trying again.',
};

/** Player-facing state/permissions. Never owns simulation or transport. */
export class PrivateLobbyView {
  private data: LobbyMessage | undefined;
  private slot: PlayerSlot | undefined;
  private connected = false;
  private phase: RoomPhase = 'waiting';
  private endless = false;
  private readonly events = new AbortController();
  private readonly panel = element('lobby-panel');
  private readonly ready = element<HTMLButtonElement>('ready');
  private readonly start = element<HTMLButtonElement>('start');
  private readonly reset = element<HTMLButtonElement>('reset');
  private readonly cancel = element<HTMLButtonElement>('cancel-restart');
  private readonly feedback = element('lobby-feedback');
  private readonly link = element<HTMLInputElement>('invite-link');
  constructor(command: (action: LobbyAction) => void) {
    const options = { signal: this.events.signal };
    this.ready.addEventListener('click', () => command(this.data?.players.find(p => p.slot === this.slot)?.ready ? 'unready' : 'ready'), options);
    this.start.addEventListener('click', () => command('start'), options);
    this.cancel.addEventListener('click', () => command('cancel-restart'), options);
    element('copy-invite').addEventListener('click', () => { void this.copyInvite(); }, options);
    this.render();
  }
  connection(connected: boolean): void { this.connected = connected; this.render(); }
  update(data: LobbyMessage, slot: PlayerSlot | undefined): void { this.data = data; this.slot = slot; this.render(); }
  gamePhase(phase: RoomPhase, endless = false): void { if (phase === this.phase && endless === this.endless) return; this.endless = endless; this.phase = phase; this.render(); }
  rejected(reason: LobbyRejectionReason): void { this.feedback.textContent = rejectionText[reason]; }
  clear(): void { this.data = undefined; this.slot = undefined; this.phase = 'waiting'; this.render(); }
  private async copyInvite(): Promise<void> {
    try { await navigator.clipboard.writeText(this.link.value); this.feedback.textContent = 'Invite link copied. Send it to your teammate.'; const visible = document.getElementById('invite-feedback'); if (visible) visible.textContent = 'Invite link copied.'; }
    catch { this.link.focus(); this.link.select(); this.feedback.textContent = 'Select and copy this invite link.'; const visible = document.getElementById('invite-feedback'); if (visible) visible.textContent = 'Select and copy this invite link.'; }
  }
  private render(): void {
    const data = this.data, own = data?.players.find(p => p.slot === this.slot);
    this.panel.hidden = !data;
    const paired = !!data && data.players.length === data.capacity && data.players.every(p => p.connected);
    const host = data?.host === this.slot, terminal = this.phase === 'ended' || this.phase === 'fault';
    this.ready.disabled = !this.connected || data?.stage !== 'lobby';
    text(this.ready, own?.ready ? 'Not ready' : 'Ready');
    this.start.disabled = !this.connected || !host || data?.stage !== 'lobby' || !paired || !data!.players.every(p => p.ready);
    this.reset.disabled = !this.connected || data?.stage !== 'playing' || !paired || (terminal && !host && !this.endless);
    const votes = data?.players.filter(p => p.restartRequested).length ?? 0;
    text(this.reset, terminal && !this.endless ? 'Restart team (R)' : this.endless ? `${own?.restartRequested ? 'Vote sent' : 'Vote to restart (R)'} · ${votes}/${data?.capacity ?? 2}` : own?.restartRequested ? 'Restart requested · waiting' : 'Request team restart (R)');
    this.cancel.hidden = !own?.restartRequested;
    this.cancel.disabled = !this.connected;
    element<HTMLButtonElement>('copy-invite').disabled = !data;
    if (!data) return;
    element('invite-code').textContent = data.code;
    const url = new URL('/play.html', window.location.href); url.hash = data.code;
    this.link.value = url.href;
    element('lobby-title').textContent = data.stage === 'lobby' ? 'Get ready together' : terminal ? 'Run finished' : 'Cross together';
    element('lobby-hint').textContent = data.stage === 'lobby'
      ? `All ${data.capacity} players choose Ready. The host starts when everyone is ready.`
      : terminal ? this.endless ? 'Every player votes to restart the same seed. All configured seats must be connected.' : 'The host can restart once all players are connected.' : 'WASD moves your player. R requests a restart; every teammate must also agree.';
    for (const slot of playerSlots) {
      element(`member-${slot}`).hidden = playerSlots.indexOf(slot) >= data.capacity;
      const player = data.players.find(p => p.slot === slot);
      element(`member-${slot}`).textContent = player
        ? `${player.displayName ?? ''} · ${({ p1: 'Goose', p2: 'Axolotl', p3: 'Capybara', p4: 'Unicorn' })[slot]}${slot === this.slot ? ' · You' : ''}${data.host === slot ? ' · Host' : ''} · ${!player.connected ? 'Reconnecting · slot reserved for 30 seconds' : data.stage === 'lobby' ? player.ready ? 'Ready' : 'Choosing ready' : player.restartRequested ? 'Wants to restart' : 'Connected'}`
        : 'Waiting for a teammate';
    }
  }
  dispose(): void { this.events.abort(); }
}
