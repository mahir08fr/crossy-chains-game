import qrcode from 'qrcode-generator';
import { isPrivateCode } from '@crossy/protocol';
export function controllerJoinLink(origin: string, code: string, diagnostics = false): string {
  if (!isPrivateCode(code)) throw new Error('Invalid room code');
  const url = new URL('/controller.html', origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid controller origin');
  if (diagnostics) url.searchParams.set('inputDiagnostics', '1');
  url.hash = code; return url.href;
}
export function controllerQr(link: string): string {
  const qr = qrcode(0, 'M'); qr.addData(link, 'Byte'); qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}
