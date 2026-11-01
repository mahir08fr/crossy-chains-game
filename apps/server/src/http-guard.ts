import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { couchRoomName, isCouchOptions, isPrivateRoomOptions, isJoinOptions, isRoomOptions, maxMessageBytes, privateRoomName, transportRoomName } from '@crossy/protocol';

export function windowLimit(maxPerSecond: number): () => boolean {
  let startsAt = performance.now(), count = 0;
  return () => {
    const now = performance.now();
    if (now - startsAt >= 1000) { startsAt = now; count = 0; }
    return ++count <= maxPerSecond;
  };
}

// Wrap Colyseus's installed HTTP handler so checks happen before body parsing or
// reservations. A CORS response alone would not prevent an unauthorized request.
export function installHttpGuard(server: Server, origins: readonly string[], maxPerSecond: number): void {
  const handlers = server.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => void)[];
  const admit = windowLimit(maxPerSecond);
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const reply = (status: number, error: string) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error }));
      req.resume();
    };
    const run = () => { for (const handler of handlers) handler.call(server, req, res); };
    if (req.url === '/health' && req.method === 'GET') { run(); return; }
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) { reply(403, 'Origin not allowed'); return; }
    const route = req.url?.match(/^\/matchmake\/(create|joinById|reconnect)\/([a-zA-Z0-9_-]{1,64})$/);
    if (!route || (route[1] === 'create' && ![transportRoomName, privateRoomName, couchRoomName].includes(route[2]!))) { reply(404, 'Unknown transport route'); return; }
    if (!admit()) { reply(429, 'Join request rate exceeded'); return; }
    if (req.method === 'OPTIONS') { run(); return; }
    if (req.method !== 'POST') { reply(405, 'POST required'); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, 'JSON required'); return; }
    if (Number(req.headers['content-length']) > maxMessageBytes) { reply(413, 'Payload too large'); return; }
    const chunks: Buffer[] = [];
    let bytes = 0, rejected = false;
    req.setTimeout(5000, () => { rejected = true; reply(408, 'Request timed out'); });
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > maxMessageBytes) { rejected = true; chunks.length = 0; reply(413, 'Payload too large'); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      req.setTimeout(0);
      if (rejected) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(400, 'Malformed JSON'); return; }
      const valid = route[1] === 'reconnect'
        ? typeof body === 'object' && body !== null && !Array.isArray(body)
          && Object.keys(body).length === 1 && 'reconnectionToken' in body
          && typeof body.reconnectionToken === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.reconnectionToken)
        : route[1] === 'create' ? route[2] === couchRoomName ? isCouchOptions(body) && body.role === 'display' : route[2] === privateRoomName ? isPrivateRoomOptions(body) : isRoomOptions(body) : isJoinOptions(body) || isCouchOptions(body);
      if (!valid) { reply(400, 'Invalid join or reconnect options'); return; }
      // Colyseus's Node router adapter understands an already-read body.
      (req as IncomingMessage & { body: unknown }).body = body;
      run();
    });
    req.on('error', () => { rejected = true; reply(400, 'Request failed'); });
  });
}
