import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ops = join(process.cwd(), 'infrastructure/containers/ops.sh');

// Runs the real `ops.sh disk-check` against a fake `df` and `docker`, so nothing touches a real server.
async function diskCheck(percentUsed, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ops-disk-'));
  try {
    await writeFile(
      join(dir, 'df'),
      `#!/usr/bin/env bash
if [[ " $* " == *" -h "* ]]; then printf 'Avail\\n 8.7G\\n'; else printf 'Use%%\\n %s%%\\n' ${percentUsed}; fi
`,
    );
    await writeFile(join(dir, 'docker'), '#!/usr/bin/env bash\necho "fake docker system df"\n');
    await chmod(join(dir, 'df'), 0o755);
    await chmod(join(dir, 'docker'), 0o755);
    const result = spawnSync('bash', [ops, 'disk-check'], {
      encoding: 'utf8',
      env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
    });
    return { status: result.status, out: result.stdout, err: result.stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('passes and reports free space when the disk is below the alert level', async () => {
  const r = await diskCheck(63);
  assert.equal(r.status, 0);
  assert.match(r.out, /Disk: 63% used, 8\.7G free \(alert at 80%\)/);
});

test('fails with a clear alert when the disk reaches the alert level', async () => {
  const r = await diskCheck(80);
  assert.equal(r.status, 1);
  assert.match(r.err, /ALERT: the server disk is 80% full/);
  assert.match(r.out, /fake docker system df/);
});

test('fails when the disk is full', async () => {
  assert.equal((await diskCheck(100)).status, 1);
});

test('the alert level can be changed with DISK_ALERT_PERCENT', async () => {
  assert.equal((await diskCheck(85, { DISK_ALERT_PERCENT: '90' })).status, 0);
  assert.equal((await diskCheck(85, { DISK_ALERT_PERCENT: '85' })).status, 1);
});
