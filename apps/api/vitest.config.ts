import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E specs run many sequential HTTP round trips against a real Postgres/Redis,
    // and have grown well past Vitest's 5s default as coverage accumulated. Bumped
    // from 20s (2026-08-11): local-pms-provider.e2e.spec.ts's largest test now
    // takes ~27s on its own, let alone under shared CI/local machine load.
    testTimeout: 45_000,
    // Every e2e app starts real BullMQ workers on the same Redis queue names
    // (mail, Clock), so files running in parallel steal each other's jobs.
    fileParallelism: false,
    hookTimeout: 45_000,
  },
});
