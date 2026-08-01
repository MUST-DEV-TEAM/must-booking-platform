import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const webDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(webDirectory, '../..');
const apiDirectory = resolve(repositoryRoot, 'apps/api');
const uiDirectory = resolve(repositoryRoot, 'packages/ui');
const typescriptCli = resolve(repositoryRoot, 'node_modules/typescript/bin/tsc');
const nextCli = resolve(webDirectory, 'node_modules/next/dist/bin/next');
const e2eEnvironment = {
  ...process.env,
  API_URL: 'http://127.0.0.1:3100',
};

runNode([typescriptCli, '--project', 'tsconfig.build.json'], process.env, uiDirectory);
runNode([typescriptCli, '--project', 'tsconfig.build.json'], process.env, apiDirectory);
runNode([nextCli, 'build'], e2eEnvironment, webDirectory);
runNode(
  [resolve(webDirectory, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)],
  e2eEnvironment,
  webDirectory,
);

function runNode(args, env, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
