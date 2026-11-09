import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = join(process.cwd(), 'infrastructure/containers/deploy-release.sh');
const API = 'ghcr.io/must-dev-team/must-booking-platform-api';
const WEB = 'ghcr.io/must-dev-team/must-booking-platform-web';

// Pulls the two disk helpers out of the real script and runs them against a fake `docker`, so the
// test checks the script as written without touching a real Docker or the real checkout.
async function run(images, { sha, previous, keep, freeKb, minKb }) {
  const dir = await mkdtemp(join(tmpdir(), 'cleanup-'));
  try {
    const log = join(dir, 'rmi.log');
    await writeFile(join(dir, 'images.txt'), images.map((i) => i.join('|')).join('\n') + '\n');
    await writeFile(
      join(dir, 'docker'),
      `#!/usr/bin/env bash
dir="${dir}"
case "$1 $2" in
  "image ls")
    if [ "$3" = "--format" ]; then cut -d'|' -f1 "$dir/images.txt" | sort -u; else
      grep "^$3|" "$dir/images.txt" | awk -F'|' '{print $2 "|" $3}'; fi ;;
  "image prune") ;;
  "info --format") echo "$dir" ;;
  rmi*) echo "$2" >> "$dir/rmi.log" ;;
esac
`,
    );
    await chmod(join(dir, 'docker'), 0o755);
    await writeFile(
      join(dir, 'df'),
      `#!/usr/bin/env bash\nprintf 'Avail\\n%s\\n' ${freeKb ?? 99999999}\n`,
    );
    await chmod(join(dir, 'df'), 0o755);
    const functions = execFileSync(
      'bash',
      [
        '-c',
        `sed -n '/^cleanup_release_images() {/,/^}/p;/^MIN_FREE_KB=/p;/^require_free_space() {/,/^}/p' "${script}"`,
      ],
      { encoding: 'utf8' },
    );
    await writeFile(
      join(dir, 'harness.sh'),
      `set -euo pipefail\nSHA="${sha}"\nPREVIOUS_TAG="${previous}"\n${keep ? `KEEP_RELEASE_IMAGES=${keep}\n` : ''}${minKb ? `MIN_FREE_KB=${minKb}\n` : ''}${functions}\nMODE="$1"\nif [ "$MODE" = clean ]; then cleanup_release_images; else require_free_space; fi\n`,
    );
    const exec = (mode) => {
      try {
        execFileSync('bash', [join(dir, 'harness.sh'), mode], {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { status: 0 };
      } catch (error) {
        return { status: error.status, stderr: String(error.stderr) };
      }
    };
    return {
      dir,
      exec,
      removed: async () =>
        (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

// Row format the fake docker expects: repository, CreatedAt, Tag.
const rows = [
  [API, '2026-11-09 12:00:00 +0000 UTC', 'c'],
  [API, '2026-11-09 10:00:00 +0000 UTC', 'b'],
  [API, '2026-11-08 10:00:00 +0000 UTC', 'a'],
  [API, '2026-11-05 10:00:00 +0000 UTC', 'old1'],
  [API, '2026-11-01 10:00:00 +0000 UTC', 'old2'],
  [WEB, '2026-11-09 12:00:00 +0000 UTC', 'c'],
  [WEB, '2026-11-05 10:00:00 +0000 UTC', 'old1'],
  ['postgres', '2025-01-01 00:00:00 +0000 UTC', '16'],
];

test('keeps the newest three release images and removes older ones', async () => {
  const t = await run(rows, { sha: 'c', previous: 'b' });
  try {
    assert.equal(t.exec('clean').status, 0);
    assert.deepEqual((await t.removed()).sort(), [`${API}:old1`, `${API}:old2`]);
  } finally {
    await rm(t.dir, { recursive: true, force: true });
  }
});

test('never removes the release being deployed or the rollback target, even when old', async () => {
  const t = await run(rows, { sha: 'c', previous: 'old2', keep: 1 });
  try {
    assert.equal(t.exec('clean').status, 0);
    const removed = await t.removed();
    assert.ok(!removed.includes(`${API}:c`));
    assert.ok(!removed.includes(`${API}:old2`));
    assert.ok(removed.includes(`${API}:old1`));
  } finally {
    await rm(t.dir, { recursive: true, force: true });
  }
});

test('leaves images that are not release images alone', async () => {
  const t = await run(rows, { sha: 'c', previous: 'b', keep: 1 });
  try {
    t.exec('clean');
    assert.ok(!(await t.removed()).some((ref) => ref.startsWith('postgres')));
  } finally {
    await rm(t.dir, { recursive: true, force: true });
  }
});

test('refuses to deploy when the disk is nearly full, and allows it with room', async () => {
  const full = await run(rows, { sha: 'c', previous: 'b', freeKb: 15 * 1024, minKb: 2097152 });
  const roomy = await run(rows, { sha: 'c', previous: 'b', freeKb: 5000000, minKb: 2097152 });
  try {
    const refused = full.exec('space');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /only 15 MB free/);
    assert.equal(roomy.exec('space').status, 0);
  } finally {
    await rm(full.dir, { recursive: true, force: true });
    await rm(roomy.dir, { recursive: true, force: true });
  }
});
