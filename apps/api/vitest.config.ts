import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E specs run many sequential HTTP round trips against a real Postgres/Redis,
    // and have grown well past Vitest's 5s default as coverage accumulated. Bumped
    // from 20s (2026-08-11): local-pms-provider.e2e.spec.ts's largest test now
    // takes ~27s on its own, let alone under shared CI/local machine load.
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
