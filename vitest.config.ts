import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Standalone of vite.config.ts on purpose: the React Router plugin owns routing and SSR
// config that the unit tests neither need nor can run under.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
