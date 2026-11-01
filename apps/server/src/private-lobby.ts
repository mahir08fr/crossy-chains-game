import { randomInt } from 'node:crypto';
import { defaultDisplayName, normalizeDisplayName, protocolVersion } from '@crossy/protocol';
import type { GroupSize, LobbyAction, LobbyMember, LobbyMessage, LobbyRejectionReason, PlayerSlot } from '@crossy/protocol';

export const lobbyIdleMs = 10 * 60_000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function reservePrivateCode(codes: Set<string>, random: (max: number) => number = randomInt): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const code = Array.from({ length: 8 }, () => alphabet[random(alphabet.length)]!).join('');
    if (!codes.has(code)) { codes.add(code); return code; }
  }
  throw new Error('Unable to allocate a private room code');
}

/** Capacity-bound lifecycle. No socket, renderer or physics dependency. */
export class PrivateLobby {
  private readonly members = new Map<PlayerSlot, LobbyMember>();
  private host: PlayerSlot | null = null;
  private epoch = 0;
  private revision = 0;
  private activityAt: number;
  stage: 'lobby' | 'playing' = 'lobby';
  constructor(readonly code: string, now: number, readonly capacity: GroupSize = 2, private readonly unanimousTerminal = false) { this.activityAt = now; }
  get acceptsJoin(): boolean { return this.stage === 'lobby' && this.members.size < this.capacity; }
  expired(now: number): boolean { return this.stage === 'lobby' && now - this.activityAt >= lobbyIdleMs; }
  private boundary(now: number): void {
    this.epoch++; this.revision++; this.activityAt = now;
    for (const member of this.members.values()) { member.ready = false; member.restartRequested = false; }
    if (!this.host || !this.members.get(this.host)?.connected) this.host = [...this.members.values()].sort((a, b) => a.slot.localeCompare(b.slot)).find(p => p.connected)?.slot ?? null;
  }
  join(slot: PlayerSlot, now: number): void {
    if (!this.acceptsJoin || !['p1', 'p2', 'p3', 'p4'].slice(0, this.capacity).includes(slot) || this.members.has(slot)) throw new Error('Private lobby is full or already started');
    this.members.set(slot, { slot, connected: true, ready: false, restartRequested: false, displayName: defaultDisplayName(slot) }); this.boundary(now);
  }
  connection(slot: PlayerSlot, connected: boolean, now: number): void {
    const member = this.members.get(slot); if (!member) throw new Error('Unknown private member');
    member.connected = connected; this.boundary(now);
  }
  leave(slot: PlayerSlot, now: number): void {
    this.members.delete(slot); this.stage = 'lobby'; this.boundary(now);
  }
  rename(slot: PlayerSlot, epoch: number, revision: number, value: string, now: number): LobbyRejectionReason | undefined {
    const member = this.members.get(slot);
    if (!member?.connected || epoch !== this.epoch || revision !== this.revision) return 'stale-command';
    if (this.stage !== 'lobby' || member.ready) return 'not-in-lobby';
    const name = normalizeDisplayName(value);
    if (name === undefined) return 'invalid-command';
    const resolved = name || defaultDisplayName(slot);
    if (member.displayName !== resolved) { member.displayName = resolved; this.revision++; this.activityAt = now; }
    return undefined;
  }
  command(slot: PlayerSlot, epoch: number, action: LobbyAction, terminal: boolean, now: number): { effect?: 'start' | 'restart'; error?: LobbyRejectionReason } {
    const member = this.members.get(slot);
    if (!member?.connected || epoch !== this.epoch) return { error: 'stale-command' };
    const paired = this.members.size === this.capacity && [...this.members.values()].every(p => p.connected);
    if (action === 'ready' || action === 'unready') {
      if (this.stage !== 'lobby') return { error: 'not-in-lobby' };
      const ready = action === 'ready';
      if (member.ready !== ready) { member.ready = ready; this.revision++; this.activityAt = now; }
      return {};
    }
    if (action === 'start') {
      if (this.stage !== 'lobby') return { error: 'not-in-lobby' };
      if (slot !== this.host) return { error: 'not-host' };
      if (!paired) return { error: 'need-two-players' };
      if (![...this.members.values()].every(p => p.ready)) return { error: 'not-ready' };
      this.stage = 'playing'; this.boundary(now); return { effect: 'start' };
    }
    if (this.stage !== 'playing') return { error: 'not-playing' };
    if (action === 'cancel-restart') {
      if (member.restartRequested) { member.restartRequested = false; this.revision++; this.activityAt = now; }
      return {};
    }
    if (!paired) return { error: 'need-two-players' };
    if (terminal && !this.unanimousTerminal) {
      if (slot !== this.host) return { error: 'not-host' };
      this.boundary(now); return { effect: 'restart' };
    }
    if (!member.restartRequested) { member.restartRequested = true; this.revision++; this.activityAt = now; }
    if ([...this.members.values()].every(p => p.restartRequested)) { this.boundary(now); return { effect: 'restart' }; }
    return {};
  }
  state(runGeneration: number): LobbyMessage {
    return { protocolVersion, capacity: this.capacity, code: this.code, epoch: this.epoch, revision: this.revision, runGeneration,
      stage: this.stage, host: this.host, players: [...this.members.values()].sort((a, b) => a.slot.localeCompare(b.slot)).map(p => ({ ...p })) };
  }
}
