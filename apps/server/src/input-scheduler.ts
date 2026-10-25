import type { InputMessage, PlayerSlot, RejectionCode } from '@crossy/protocol';

export const staleInputMs = 250;
type Stream = {
  generation: number;
  sequence: number;
  references: number[];
  expiresAt: number;
  acceptedAt: number;
  requiresNeutral: boolean;
  neutralReason: 'connected' | 'cleared' | 'expired' | null;
  x: number;
  z: number;
  tokens: number;
  tokenTime: number;
};

/** Latest-value scheduling only; no physics imports, packet replay or input queue. */
export class InputScheduler {
  private readonly streams = new Map<PlayerSlot, Stream>();

  constructor(private readonly onExpired?: (slot: PlayerSlot, sequence: number, silenceMs: number, now: number) => void, private capacity = 2) {}

  setCapacity(capacity: number): void { this.capacity = capacity; }

  connect(slot: PlayerSlot, generation: number, now: number): void {
    this.streams.set(slot, { generation, sequence: 0, references: [], expiresAt: 0, acceptedAt: now,
      requiresNeutral: true, neutralReason: 'connected', x: 0, z: 0, tokens: 10, tokenTime: now });
  }
  disconnect(slot: PlayerSlot): void { this.streams.delete(slot); }
  clear(): void {
    for (const stream of this.streams.values()) {
      stream.x = stream.z = stream.expiresAt = 0;
      stream.requiresNeutral = true; stream.neutralReason = 'cleared';
      stream.references = [];
    }
  }
  issueReference(slot: PlayerSlot, now: number): void {
    const stream = this.streams.get(slot);
    if (!stream) return;
    stream.references = stream.references.filter((time) => now - time <= staleInputMs);
    stream.references.push(now);
    if (stream.references.length > 32) stream.references.shift();
  }

  accept(slot: PlayerSlot, input: InputMessage, runGeneration: number, now: number): RejectionCode | undefined {
    const stream = this.streams.get(slot);
    if (!stream || input.connectionGeneration !== stream.generation || input.runGeneration !== runGeneration) return 'invalid-generation';
    if (input.sequence <= stream.sequence) return 'old-sequence';
    this.expire(now);
    if (!stream.references.includes(input.referenceTimeMs) || now < input.referenceTimeMs
      || now - input.referenceTimeMs >= staleInputMs) return 'stale-input';
    stream.tokens = Math.min(10, stream.tokens + Math.max(0, now - stream.tokenTime) * 40 / 1000);
    stream.tokenTime = now;
    if (stream.tokens < 1) return 'rate-limit';
    stream.tokens--;
    if (stream.requiresNeutral && (input.x !== 0 || input.z !== 0)) return 'requires-neutral';
    stream.requiresNeutral = false; stream.neutralReason = null;
    stream.sequence = input.sequence;
    stream.x = input.x;
    stream.z = input.z;
    // Reference age bounds delayed packets; stream silence is a different clock.
    // Network round trips must not consume the 250 ms inter-arrival lease.
    stream.acceptedAt = now;
    stream.expiresAt = now + staleInputMs;
  }

  expire(now: number): boolean {
    const expired: { slot: PlayerSlot; sequence: number; silenceMs: number }[] = [];
    for (const [slot, stream] of this.streams) {
      if (!stream.requiresNeutral && now >= stream.expiresAt) {
        expired.push({ slot, sequence: stream.sequence, silenceMs: now - stream.acceptedAt });
        stream.x = stream.z = stream.expiresAt = 0;
        stream.requiresNeutral = true; stream.neutralReason = 'expired';
        stream.references = [];
      }
    }
    // Physics still pauses for the group, but healthy streams have not expired.
    for (const event of expired) this.onExpired?.(event.slot, event.sequence, event.silenceMs, now);
    return expired.length > 0;
  }

  diagnostics(now: number) {
    return [...this.streams].map(([slot, s]) => ({ slot, generation: s.generation, sequence: s.sequence, requiresNeutral: s.requiresNeutral,
      neutralReason: s.neutralReason, silenceMs: s.sequence === 0 ? null : Math.max(0, now - s.acceptedAt) }));
  }

  get ready(): boolean {
    return this.streams.size === this.capacity && [...this.streams.values()].every((stream) => !stream.requiresNeutral);
  }
  latest(slot: PlayerSlot): { x: number; z: number; sequence: number } {
    const stream = this.streams.get(slot);
    return { x: stream?.x ?? 0, z: stream?.z ?? 0, sequence: stream?.sequence ?? 0 };
  }
}
