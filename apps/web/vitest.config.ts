import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    // The settings, account and reports forms render many controls; under the parallel full run
    // the default 5 s was too tight and caused load-only failures (they pass alone).
    testTimeout: 20_000,
  },
});
