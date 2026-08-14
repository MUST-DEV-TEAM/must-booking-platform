import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const reporter = join(root, 'infrastructure/containers/report-operational-alert.mjs');
const driftCheck = join(root, 'infrastructure/containers/check-deploy-drift.mjs');
const deploy = join(root, 'infrastructure/containers/deploy.sh');

async function captureSentryEnvelope(run) {
  let received = '';
  const server = createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', (chunk) => (received += chunk));
    request.on('end', () => response.writeHead(200).end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://public-key@127.0.0.1:${address.port}/42`);
    return received;
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('operational alert reporter sends a Sentry envelope', async () => {
  const envelope = await captureSentryEnvelope(async (dsn) => {
    const result = await run(
      process.execPath,
      [reporter, '--source', 'deploy-drift', '--message', 'test drift'],
      {
        env: { ...process.env, SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'test' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  });
  const event = JSON.parse(envelope.trim().split('\n')[2]);
  assert.equal(event.message, 'test drift');
  assert.equal(event.tags.operation, 'deploy-drift');
  assert.equal(event.tags.environment, 'test');
});

test('deploy script refuses root before it can mutate the checkout', async (context) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0)
    return context.skip('requires a root test process');
  const result = await run('bash', [deploy], { env: process.env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to deploy as root/);
});

test('deploy drift check reports an old deployed commit and fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'must-deploy-drift-'));
  const source = join(directory, 'source');
  const origin = join(directory, 'origin.git');
  const deployed = join(directory, 'deployed');
  try {
    execFileSync('git', ['init', '--initial-branch=main', source]);
    execFileSync('git', ['-C', source, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', source, 'config', 'user.name', 'Test']);
    await writeFile(join(source, 'README.md'), 'initial\n');
    execFileSync('git', ['-C', source, 'add', '.']);
    execFileSync('git', ['-C', source, 'commit', '-m', 'initial']);
    execFileSync('git', ['clone', '--bare', source, origin]);
    execFileSync('git', ['clone', origin, deployed]);
    await writeFile(join(source, 'README.md'), 'new main\n');
    execFileSync('git', ['-C', source, 'add', '.']);
    execFileSync('git', ['-C', source, 'commit', '-m', 'new main']);
    execFileSync('git', ['-C', source, 'push', origin, 'main']);

    const envelope = await captureSentryEnvelope(async (dsn) => {
      const result = await run(process.execPath, [driftCheck], {
        env: {
          ...process.env,
          DEPLOY_REPOSITORY: deployed,
          SENTRY_DSN: dsn,
          SENTRY_ENVIRONMENT: 'test',
        },
      });
      assert.equal(result.status, 1, result.stderr);
    });
    const event = JSON.parse(envelope.trim().split('\n')[2]);
    assert.equal(event.tags.operation, 'deploy-drift');
    assert.match(event.message, /Deploy drift detected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
