import { createServer, connect } from 'node:net';
import type { Socket } from 'node:net';

export async function relay(serverPort: number, profile: { delay: number; jitter: number; holdEvery: number }) {
  const sockets = new Set<Socket>(), timers = new Set<ReturnType<typeof setTimeout>>();
  let seed = 41, chunks = 0, bytes = 0, holds = 0, pausedUntil = 0, maxDeliveryLatenessMs = 0;
  const server = createServer((browser) => {
    const backend = connect(serverPort, '127.0.0.1');
    for (const socket of [browser, backend]) {
      sockets.add(socket); socket.setNoDelay(true);
      socket.on('error', () => { browser.destroy(); backend.destroy(); });
      socket.on('close', () => { sockets.delete(socket); browser.destroy(); backend.destroy(); });
    }
    for (const [source, destination] of [[browser, backend], [backend, browser]] as const) {
      let lastDelivery = 0;
      source.on('data', (data: Buffer) => {
        seed = (seed * 1664525 + 1013904223) >>> 0; chunks++; bytes += data.length;
        const hold = profile.holdEvery && chunks % profile.holdEvery === 0 ? 120 : 0;
        if (hold) holds++;
        const delivery = Math.max(pausedUntil, lastDelivery, performance.now() + profile.delay + (seed / 2 ** 32 * 2 - 1) * profile.jitter + hold);
        lastDelivery = delivery;
        const timer = setTimeout(() => { timers.delete(timer); maxDeliveryLatenessMs = Math.max(maxDeliveryLatenessMs, performance.now() - delivery); if (!destination.destroyed) destination.write(data); }, Math.max(0, delivery - performance.now()));
        timers.add(timer);
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing relay listener');
  return { hold: (milliseconds: number) => { pausedUntil = performance.now() + milliseconds; }, endpoint: `http://127.0.0.1:${address.port}`, metrics: () => ({ chunks, bytes, holds, maxDeliveryLatenessMs }),
    async stop() { for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
