import { playerSlots, defaultDisplayName } from '@crossy/protocol';
import type { LobbyMessage, PlayerSlot, SnapshotMessage } from '@crossy/protocol';

export function nextCapacity(current: number, direction: 1 | -1, active: boolean): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, current + (active ? 0 : direction))) as 2 | 3 | 4;
}
export function canHostStart(data: LobbyMessage | undefined, slot?: PlayerSlot): boolean {
  return !!data && data.host === slot && data.stage === 'lobby' && data.players.length === data.capacity
    && data.players.every(p => p.connected && (p.slot === slot || p.ready));
}
export type FailurePresentation = { slots: PlayerSlot[]; cause: string; failed: boolean };
/** Only identify a cause present in the authoritative course payload. No inference from proximity. */
export function failurePresentation(s: SnapshotMessage): FailurePresentation {
  const source = s.world ?? s.railway ?? s.river ?? s.road;
  const slots = source?.dead ?? [];
  if (!slots.length) { const cleared=source?.outcome==='cleared'; return { slots: [], cause: s.phase === 'fault' ? 'The team stopped for physics safety.' : cleared ? 'Everyone crossed together!' : 'The team attempt has ended.', failed: !cleared }; }
  const causes = new Set<string>();
  for (const id of slots) {
    if ((s.world?.water ?? s.river)?.dead.includes(id)) causes.add('drowned');
    if (s.road?.dead.includes(id) || s.world?.hazards.some(h => h.road?.dead.includes(id))) causes.add('was hit by traffic');
    if (s.railway?.dead.includes(id) || s.world?.hazards.some(h => h.railway?.dead.includes(id))) causes.add('was hit by a train');
  }
  return { slots, cause: causes.size === 1 ? [...causes][0]! : 'could not finish the crossing', failed: true };
}
export function failureNames(slots: PlayerSlot[], data?: LobbyMessage): string {
  return slots.map(slot => data?.players.find(p => p.slot === slot)?.displayName || defaultDisplayName(slot)).join(' & ');
}
export function cinematicPose(seconds: number, reduced = false): { y: number; flip: number; done: boolean } {
  const t = Math.max(0, seconds);
  if (reduced) return { y: 0, flip: 0, done: t >= .15 };
  // Smooth ascent, readable belly-down apex, accelerating fall. Presentation metres only.
  if (t < .7) { const u = t / .7; return { y: 2.7 * (1 - (1-u)**3), flip: (Math.PI * 2 + Math.PI / 2) * (u*u*(3-2*u)), done: false }; }
  if (t < 1) return { y: 2.7, flip: Math.PI * 2 + Math.PI / 2, done: false };
  return { y: 2.7 - 15 * ((t-1)/.85)**2, flip: Math.PI * 2 + Math.PI / 2, done: t >= 1.85 };
}
export function reachablePhoneOrigin(origin: string, endpoint: string): boolean {
  const local = (value: string) => { const h = new URL(value).hostname; return h === 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') || ['[::1]','0.0.0.0'].includes(h); };
  return !local(origin) && !local(endpoint);
}
export { playerSlots };
