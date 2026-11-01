/** The SDK accepts an HTTP origin and selects WS/WSS from its protocol. */
export function readTransportEndpoint(value?: string, requireHttps = false): string {
  if (requireHttps && !value) throw new Error('HTTPS hosting requires an explicit VITE_SERVER_URL');
  const endpoint = value ?? 'http://127.0.0.1:2567';
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new Error('VITE_SERVER_URL must be an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== endpoint) {
    throw new Error('VITE_SERVER_URL must be an exact HTTP(S) origin without credentials, paths or query parameters');
  }
  if (requireHttps && (url.protocol !== 'https:' || url.hostname === 'localhost'
    || url.hostname.endsWith('.localhost') || url.hostname.startsWith('127.')
    || ['0.0.0.0', '[::1]'].includes(url.hostname))) {
    throw new Error('Hosted VITE_SERVER_URL must use a non-loopback HTTPS origin');
  }
  return endpoint;
}
