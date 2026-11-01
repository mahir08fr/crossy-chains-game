import { defaultDisplayName, normalizeDisplayName } from '@crossy/protocol';
import type { LobbyMessage, PlayerSlot } from '@crossy/protocol';

/** Owner-only editor; only the lobby echo confirms a submitted name. */
export class NameInput {
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly submit = document.createElement('button');
  private readonly status = document.createElement('small');
  private confirmed = '';
  private pending: string | undefined;
  private editable = false;
  constructor(parent: HTMLElement, save: (name: string) => void) {
    this.form.className = 'name-editor';
    const label = document.createElement('label');
    label.textContent = 'Your name';
    this.input.name = 'display-name'; this.input.autocomplete = 'off'; this.input.placeholder = 'Player name';
    this.input.setAttribute('aria-label','Your display name, up to 16 characters'); this.input.size = 12;
    this.status.setAttribute('role','status'); this.status.setAttribute('aria-live','polite');
    this.submit.type = 'submit'; this.submit.textContent = 'Save'; this.submit.hidden = true;
    label.append(this.input); this.form.append(label,this.submit,this.status); parent.append(this.form);
    this.input.addEventListener('input', () => { this.status.textContent = ''; this.submit.hidden = this.input.value === this.confirmed; });
    this.input.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); if (this.pending !== undefined) return; this.input.value = this.confirmed; this.submit.hidden = true; this.status.textContent = 'Edit cancelled';
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault(); if (this.input.disabled || this.pending !== undefined) return;
      const value = normalizeDisplayName(this.input.value);
      if (value === undefined) { this.status.textContent = 'Use up to 16 characters without markup or controls.'; return; }
      if ((value || this.confirmed) === this.confirmed && value !== '') { this.submit.hidden = true; return; }
      this.pending = value; this.input.disabled = this.submit.disabled = true;
      this.status.textContent = 'Saving…'; save(value);
    });
    this.form.hidden = true;
  }
  feedback(message: string): void {
    if (this.pending === undefined || !/rejected|unavailable|failed/i.test(message)) return;
    this.pending = undefined; this.input.disabled = this.submit.disabled = !this.editable; this.status.textContent = 'Name was not saved. Check the room status and try again.';
  }
  update(data: LobbyMessage, slot?: PlayerSlot): void {
    const own = data.players.find(p => p.slot === slot);
    this.form.hidden = !own;
    const name = own?.displayName ?? (slot ? defaultDisplayName(slot) : '');
    const echoed = this.pending !== undefined && name === (this.pending || (slot ? defaultDisplayName(slot) : ''));
    if (echoed) { this.pending = undefined; this.input.value = name; this.submit.hidden = true; this.status.textContent = 'Saved'; }
    if (name !== this.confirmed) { this.input.value = name; this.confirmed = name; }
    this.editable = !!own?.connected && !own.ready && data.stage === 'lobby';
    this.input.disabled = this.submit.disabled = this.pending !== undefined || !this.editable;
    if (own?.ready && this.pending === undefined) this.status.textContent = 'Choose Not ready to edit';
    else if (data.stage === 'playing') this.status.textContent = '';
    this.form.hidden = !own || data.stage !== 'lobby';
  }
  clear(): void { this.form.hidden = true; this.input.value = this.confirmed = ''; this.pending = undefined; this.status.textContent = ''; }
  dispose(): void { this.form.remove(); }
}
