import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { readTransportEndpoint } from './apps/game/src/network-endpoint.ts';

export default defineConfig(({ command, mode }) => {
  // Render sets RENDER=true for all runtimes. Local builds keep loopback defaults.
  if (command === 'build' && process.env.RENDER === 'true') {
    const env = loadEnv(mode, 'apps/game', 'VITE_');
    readTransportEndpoint(env.VITE_SERVER_URL, true);
  }
  return {
    root: 'apps/game',
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { outDir: '../../dist', emptyOutDir: true, rolldownOptions: { input: ['index', 'network', 'multiplayer', 'play', 'display', 'controller', 'local', 'playground'].map((page) => fileURLToPath(new URL(`./apps/game/${page}.html`, import.meta.url))) } },
  };
});
