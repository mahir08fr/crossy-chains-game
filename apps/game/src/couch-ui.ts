import type { LobbyAction, LobbyMessage, PlayerSlot, RoomPhase } from '@crossy/protocol';
import { playerSlots } from '@crossy/protocol';
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing element ${id}`); return node as T;
}
export const playerNames: Record<PlayerSlot, string> = { p1: 'Goose', p2: 'Axolotl', p3: 'Capybara', p4: 'Unicorn' };
export function setText(node: HTMLElement, text: string): void { if (node.textContent !== text) node.textContent = text; }
export class CouchLobbyView {
  private data: LobbyMessage | undefined;
  private slot: PlayerSlot | undefined;
  private phase: RoomPhase = 'waiting';
  private endless = false;
  private connected = false;
  private readonly events = new AbortController();
  constructor(private readonly display: boolean, command: (action: LobbyAction) => void) {
    const opts = { signal: this.events.signal };
    element('ready').addEventListener('click', () => command(this.data?.players.find(p => p.slot === this.slot)?.ready ? 'unready' : 'ready'), opts);
    element('start').addEventListener('click', () => command('start'), opts);
    element('restart').addEventListener('click', () => command('restart'), opts);
    element('cancel-restart').addEventListener('click', () => command('cancel-restart'), opts);
    element('ready').hidden = display; element('cancel-restart').hidden = display; this.render();
  }
  connection(connected: boolean): void { this.connected = connected; if (!connected) { this.slot = undefined; this.data = undefined; } this.render(); }
  update(data: LobbyMessage, slot?: PlayerSlot): void { if (data.revision === this.data?.revision && this.slot === slot) return; this.data = data; this.slot = slot; this.render(); }
  gamePhase(phase: RoomPhase, endless = false): void { if (this.phase === phase && this.endless === endless) return; this.endless = endless; this.phase = phase; this.render(); }
  private render(): void {
    const data = this.data, own = data?.players.find(p => p.slot === this.slot), host = this.display || data?.host === this.slot;
    const paired = !!data && data.players.length === data.capacity && data.players.every(p => p.connected);
    const terminal = this.phase === 'ended' || this.phase === 'fault';
    element<HTMLButtonElement>('ready').disabled = !this.connected || data?.stage !== 'lobby';
    setText(element('ready'), own?.ready ? 'Not ready' : 'Ready');
    element<HTMLButtonElement>('start').disabled = !this.connected || !host || data?.stage !== 'lobby' || !paired || !data?.players.every(p => p.ready);
    element('start').hidden = !host;
    element<HTMLButtonElement>('restart').disabled = !this.connected || data?.stage !== 'playing' || !paired || (this.display ? !terminal || this.endless : terminal && !host && !this.endless);
    const votes = data?.players.filter(p => p.restartRequested).length ?? 0;
    setText(element('restart'), this.endless ? `${this.display ? 'Phones vote to restart' : own?.restartRequested ? 'Vote sent' : 'Vote to restart'} · ${votes}/${data?.capacity ?? 2}` : terminal ? 'Restart team' : own?.restartRequested ? 'Vote sent · waiting' : this.display ? 'Phones vote to restart' : 'Vote to restart');
    element('cancel-restart').hidden = this.display || !own?.restartRequested;
    element('seats').replaceChildren(...playerSlots.slice(0, data?.capacity ?? 2).map(slot => {
      const member = data?.players.find(p => p.slot === slot), node = document.createElement('li');
      node.dataset.slot = slot;
      node.textContent = `${member?.displayName ?? playerNames[slot]} · ${slot.toUpperCase()}${this.slot === slot ? ' · You' : ''}${data?.host === slot ? ' · Phone host' : ''} — ${!member ? 'Waiting' : !member.connected ? 'Reconnecting (30s)' : member.ready ? 'Ready' : member.restartRequested ? 'Restart vote' : data?.stage === 'playing' ? 'Connected' : 'Not ready'}`;
      return node;
    }));
    setText(element('room-code'), data?.code ?? '—');
  }
  dispose(): void { this.events.abort(); }
}
