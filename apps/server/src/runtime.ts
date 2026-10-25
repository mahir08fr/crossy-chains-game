import { initializePhysics } from '@crossy/simulation';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { couchRoomName, maxMessageBytes, protocolVersion, privateRoomName, transportRoomName } from '@crossy/protocol';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { installHttpGuard, windowLimit } from './http-guard.js';
import { TransportTestRoom } from './transport-room.js';
import type { RoomAdmission } from './transport-room.js';
import type { ServerConfig } from './config.js';

export function createServerRuntime(config: ServerConfig) {
  let ready = false;
  const admitUpgrade = windowLimit(30);
  const admission: RoomAdmission = { activeRooms: 0, nextGeneration: 0, maxRooms: 2, privateCodes: new Set<string>(), sessions: new Set() };
  const server = new Server({
    transport: new WebSocketTransport({
      maxPayload: maxMessageBytes,
      perMessageDeflate: false,
      beforeUpgrade: (_request, context) => {
        const origin = context.headers.get('origin');
        if (!origin || !config.allowedOrigins.includes(origin)) return new Response('Origin not allowed', { status: 403 });
        if (!admitUpgrade()) return new Response('Upgrade rate exceeded', { status: 429 });
      },
    }),
    gracefullyShutdown: false,
    greet: false,
    express: (app) => {
      app.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ready, protocolVersion }));
      });
    },
  });
  server.define(transportRoomName, TransportTestRoom, { admission });
  server.define(privateRoomName, TransportTestRoom, { admission, privateRoom: true });
  server.define(couchRoomName, TransportTestRoom, { admission, privateRoom: true, couchRoom: true });
  const httpServer = server.transport.server!;
  let stopping: Promise<void> | undefined;
  return {
    server,
    async start(port = config.port): Promise<number> {
      await initializePhysics();
      // Colyseus logs listener errors; explicitly reject so startup cannot hang.
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        httpServer.once('error', onError);
        void server.listen(port, config.host).then(() => {
          httpServer.removeListener('error', onError);
          resolve();
        }, (error: unknown) => {
          httpServer.removeListener('error', onError);
          reject(error);
        });
      });
      installHttpGuard(httpServer, config.allowedOrigins, 30);
      ready = true;
      const address = httpServer.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
      return address.port;
    },
    stop(): Promise<void> {
      return stopping ??= (async () => {
        ready = false;
        const closed = httpServer.listening
          ? new Promise<void>((resolve) => httpServer.once('close', resolve))
          : Promise.resolve();
        httpServer.closeIdleConnections();
        await server.gracefullyShutdown(false);
        await closed;
      })();
    },
  };
}
