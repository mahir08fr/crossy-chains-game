import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config.js';
import { createServerRuntime } from './runtime.js';

describe('Node transport runtime', () => {
  it('validates configuration and binds only to loopback by default', () => {
    expect(readServerConfig({}).host).toBe('127.0.0.1');
    expect(readServerConfig({ PORT: '10000', HOST: '0.0.0.0', ALLOWED_ORIGINS: 'https://game.example' }).port).toBe(10000);
    for (const PORT of ['0', '-1', '1.5', '65536', 'hello']) expect(() => readServerConfig({ PORT })).toThrow();
    for (const ALLOWED_ORIGINS of ['', '*', 'null', 'https://game.example/path', 'https://game.example/']) {
      expect(() => readServerConfig({ ALLOWED_ORIGINS })).toThrow();
    }
  });

  it('fails closed on Render without explicit binding and secure origins', () => {
    const config = { RENDER: 'true', HOST: '0.0.0.0', PORT: '10000', ALLOWED_ORIGINS: 'https://game.example' };
    expect(readServerConfig(config).allowedOrigins).toEqual(['https://game.example']);
    for (const key of ['HOST', 'PORT', 'ALLOWED_ORIGINS']) {
      expect(() => readServerConfig({ ...config, [key]: undefined })).toThrow();
    }
    expect(() => readServerConfig({ ...config, HOST: '127.0.0.1' })).toThrow();
    for (const ALLOWED_ORIGINS of ['http://game.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', '*']) {
      expect(() => readServerConfig({ ...config, ALLOWED_ORIGINS })).toThrow();
    }
  });

  it('serves readiness, shuts down idempotently and releases its TCP port', async () => {
    const runtime = createServerRuntime(readServerConfig({}));
    const port = await runtime.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ready: true, protocolVersion: 1 });
    } finally { await Promise.all([runtime.stop(), runtime.stop()]); }
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
