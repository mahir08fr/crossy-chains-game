import { defaultDisplayName, playerSlots } from '@crossy/protocol';
import type { LobbyMessage, PlayerSlot } from '@crossy/protocol';
export class NamedFeedback {
  private readonly names = new Map<PlayerSlot,string>();
  update(data: LobbyMessage): void { this.names.clear(); for (const p of data.players) this.names.set(p.slot,p.displayName ?? defaultDisplayName(p.slot)); }
  clear(): void { this.names.clear(); }
  format(message: string): string {
    // One pass over original text; a name containing P2 is never recursively replaced.
    return message.replace(/\bp[1-4]\b/gi, slot => { const id = playerSlots.find(p => p === slot.toLowerCase())!; return this.names.get(id) ?? defaultDisplayName(id); });
  }
}
