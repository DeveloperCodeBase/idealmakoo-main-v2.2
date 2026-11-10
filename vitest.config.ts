import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/server-api.integration.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    reporters: ['default'],
    passWithNoTests: false,
  },
});
