import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const webDirectory = __dirname;
const repositoryRoot = resolve(webDirectory, '../..');
const apiDirectory = resolve(repositoryRoot, 'apps/api');
const apiEnvironmentPath = resolve(apiDirectory, '.env');

if (existsSync(apiEnvironmentPath)) process.loadEnvFile(apiEnvironmentPath);

const apiOrigin = 'http://127.0.0.1:3100';
const webOrigin = 'http://127.0.0.1:3101';
const mailSinkOrigin = 'http://127.0.0.1:3130';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: '../../output/playwright/test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['html', { outputFolder: '../../output/playwright/report' }], ['list']]
    : 'list',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node e2e/mail-sink.mjs',
      cwd: webDirectory,
      url: `${mailSinkOrigin}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm start',
      cwd: apiDirectory,
      url: `${apiOrigin}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        APP_PORT: '3100',
        WEB_APP_URL: webOrigin,
        RESEND_API_BASE_URL: mailSinkOrigin,
        RESEND_API_KEY: 'e2e-local-resend-key',
        MAIL_FROM_EMAIL: 'MUST E2E <e2e@must.local>',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm run start:e2e',
      cwd: webDirectory,
      url: webOrigin,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        API_URL: apiOrigin,
        NODE_ENV: 'production',
        PORT: '3101',
      },
    },
  ],
});
