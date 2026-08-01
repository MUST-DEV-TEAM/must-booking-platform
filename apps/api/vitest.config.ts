import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E specs run many sequential HTTP round trips against a real Postgres/Redis,
    // and have grown well past Vitest's 5s default as coverage accumulated.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
