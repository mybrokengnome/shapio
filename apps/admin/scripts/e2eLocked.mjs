// Builds the admin and runs Playwright while holding a lock, so implementers sharing one working tree never
// overwrite each other's `dist` mid-run. Usage: pnpm --filter @shapio/admin e2e:locked [playwright args]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = join(ADMIN_DIR, 'e2e', '.artifacts', 'e2e.lock');
const POLL_MS = 5_000;

const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
};

const readHolder = () => {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return undefined;
  }
};

/** Creates the lock file exclusively; a lock left by a process that no longer runs is taken over. */
const acquire = async () => {
  mkdirSync(dirname(LOCK_FILE), { recursive: true });
  let announced = false;
  for (;;) {
    try {
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }), {
        flag: 'wx',
      });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    const holder = readHolder();
    if (!holder || !isRunning(holder.pid)) {
      rmSync(LOCK_FILE, { force: true });
      continue;
    }
    if (!announced) {
      process.stderr.write(`e2e:locked: waiting for pid ${holder.pid} (running since ${holder.since})…\n`);
      announced = true;
    }
    await sleep(POLL_MS);
  }
};

const release = () => {
  if (readHolder()?.pid === process.pid) {
    rmSync(LOCK_FILE, { force: true });
  }
};

const run = (command, args) =>
  spawnSync(command, args, { cwd: ADMIN_DIR, stdio: 'inherit', shell: process.platform === 'win32' })
    .status ?? 1;

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    release();
    process.exit(130);
  });
}

/** `vite build` only: typecheck runs separately, so another package's type error elsewhere in the shared
 * tree doesn't block this run (a missing export still fails the bundle). */
const buildAndTest = () => {
  const built = run('pnpm', ['exec', 'vite', 'build']);
  return built === 0 ? run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)]) : built;
};

await acquire();
try {
  process.exitCode = buildAndTest();
} finally {
  release();
}
