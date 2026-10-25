import { readServerConfig } from './config.js';
import { createServerRuntime } from './runtime.js';

async function main(): Promise<void> {
  const config = readServerConfig();
  const runtime = createServerRuntime(config);
  const shutdown = () => {
    void runtime.stop().catch((error: unknown) => { console.error('Server shutdown failed:', error); process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    const port = await runtime.start();
    console.info(`Crossy Chains transport server listening on ${config.host}:${port}`);
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

void main().catch((error: unknown) => { console.error('Server startup failed:', error); process.exitCode = 1; });
