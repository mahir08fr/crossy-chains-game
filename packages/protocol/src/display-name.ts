/** Room-scoped plain text, NFC and grapheme-limited; never an identity/credential. */
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
export function defaultDisplayName(slot: string): string { return `Player ${slot.slice(1)}`; }
export function normalizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>]/u.test(value)) return undefined;
  const normalized = value.normalize('NFC').trim().replace(/\p{Zs}+/gu, ' ');
  if (normalized && !/[\p{L}\p{N}\p{P}\p{S}]/u.test(normalized)) return undefined;
  const parts = [...graphemes.segment(normalized)];
  if (parts.length > 16 || parts.some(p => p.segment.length > 32)) return undefined;
  return normalized;
}
