import { execFileSync } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { reportOperationalAlert } from './report-operational-alert.mjs';

const repository = resolve(process.env.DEPLOY_REPOSITORY || join(import.meta.dirname, '../..'));

function git(...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function firstForeignOwnedPath(path, uid) {
  const info = await lstat(path);
  if (info.uid !== uid) return path;
  if (!info.isDirectory()) return undefined;
  for (const entry of await readdir(path)) {
    const found = await firstForeignOwnedPath(join(path, entry), uid);
    if (found) return found;
  }
  return undefined;
}

async function fail(source, message) {
  try {
    await reportOperationalAlert(source, message);
  } catch (error) {
    console.error(`CRITICAL: ${message} (and reporting to Sentry failed: ${error instanceof Error ? error.message : String(error)}).`);
  }
  process.exitCode = 1;
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  await fail('deploy-preflight', 'Deploy drift check was invoked as root. It must run as the dedicated deploy user.');
} else {
  try {
    if (process.platform === 'linux' && typeof process.getuid === 'function') {
      const foreignPath = await firstForeignOwnedPath(repository, process.getuid());
      if (foreignPath) {
        await fail('deploy-preflight', `Deploy checkout ownership drift: ${foreignPath} is not owned by the deploy user.`);
      } else {
        git('fetch', '--quiet', 'origin', 'main');
      }
    } else {
      git('fetch', '--quiet', 'origin', 'main');
    }
    if (!process.exitCode) {
      const deployedCommit = git('rev-parse', 'HEAD');
      const originCommit = git('rev-parse', 'origin/main');
      if (deployedCommit !== originCommit)
        await fail('deploy-drift', `Deploy drift detected: deployed=${deployedCommit} origin/main=${originCommit}`);
      else console.log(`Deploy drift check passed: ${deployedCommit} matches origin/main.`);
    }
  } catch {
    await fail('deploy-drift', 'Deploy drift check could not fetch origin/main as the deploy user.');
  }
}
