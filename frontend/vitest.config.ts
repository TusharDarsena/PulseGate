import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      ticket: fileURLToPath(new URL('./src/contracts/ticket/src/index.ts', import.meta.url)),
      marketplace: fileURLToPath(new URL('./src/contracts/marketplace/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
