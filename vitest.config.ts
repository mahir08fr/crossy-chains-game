import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each physics test file initializes WASM; one worker avoids contention during browser review.
  test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], maxWorkers: 1 },
});
