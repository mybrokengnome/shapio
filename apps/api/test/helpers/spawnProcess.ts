import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { API_ROOT } from './env.js';
import { describeDuration } from './waitFor.js';

export type LogLine = { msg?: string; level?: number } & Record<string, unknown>;

/** Long enough for a cold `tsx` start plus migrations on a busy CI runner. */
export const LOG_WAIT_TIMEOUT_MS = 30_000;
/** A clean shutdown drains requests and jobs; anything slower than this is a hang. */
export const EXIT_TIMEOUT_MS = 15_000;

export type WaitForLogOptions = {
  timeoutMs?: number;
  /** The line being waited for, for the failure message ("the 'worker started' line"). */
  description?: string;
};

export type StopOptions = { timeoutMs?: number };

export type SpawnedProcess = {
  child: ChildProcess;
  pid: number;
  logs: LogLine[];
  /** Resolves with the first log line matching `predicate` (or rejects after `timeoutMs` / on exit). */
  waitForLog: (predicate: (line: LogLine) => boolean, options?: WaitForLogOptions) => Promise<LogLine>;
  /**
   * Sends `signal` and resolves with the exit code (null when killed by a signal) once the process has exited
   * and its output is fully read, so `logs` holds every line it wrote. A process still running after
   * `timeoutMs` is SIGKILLed and the call rejects, naming the signal that was ignored.
   */
  stop: (signal?: NodeJS.Signals, options?: StopOptions) => Promise<number | null>;
};

/** Every child still running, so a test process that dies early never leaves servers behind. */
const live = new Set<ChildProcess>();
process.once('exit', () => {
  for (const child of live) {
    child.kill('SIGKILL');
  }
});

/**
 * Runs a TypeScript entry of apps/api in a child Node process (via tsx), with JSON logs on stdout.
 * Only the given env plus PATH/HOME is passed, so the child never picks up the developer's .env.
 */
export const spawnTsProcess = (entry: string, env: Record<string, string>): SpawnedProcess => {
  const child = spawn(process.execPath, ['--conditions=@shapio/source', '--import', 'tsx', entry], {
    cwd: API_ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LOG_PRETTY: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn ${entry}`);
  }
  live.add(child);
  const logs: LogLine[] = [];
  const waiters = new Set<{ predicate: (line: LogLine) => boolean; resolve: (line: LogLine) => void }>();
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  createInterface({ input: child.stdout }).on('line', (text) => {
    let line: LogLine;
    try {
      line = JSON.parse(text) as LogLine;
    } catch {
      line = { msg: text };
    }
    logs.push(line);
    for (const waiter of waiters) {
      if (waiter.predicate(line)) {
        waiters.delete(waiter);
        waiter.resolve(line);
      }
    }
  });
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  // 'close' follows 'exit' once stdout/stderr are drained: only then is every log line in `logs`.
  const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
  void closed.finally(() => live.delete(child)).catch(() => undefined);
  const output = () =>
    `\nstderr:\n${stderr.join('')}\nlogs:\n${logs.map((l) => JSON.stringify(l)).join('\n')}`;

  return {
    child,
    pid: child.pid,
    logs,
    waitForLog: (predicate, { timeoutMs = LOG_WAIT_TIMEOUT_MS, description = 'the expected line' } = {}) => {
      const existing = logs.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.add(waiter);
        const fail = (reason: string) => {
          waiters.delete(waiter);
          reject(new Error(`${reason}${output()}`));
        };
        const timer = setTimeout(
          () => fail(`${entry} did not log ${description} within ${describeDuration(timeoutMs)}`),
          timeoutMs,
        );
        void closed.then(([code]) => {
          if (waiters.has(waiter)) {
            clearTimeout(timer);
            fail(`${entry} exited with code ${String(code)} before logging ${description}`);
          }
        });
        const originalResolve = waiter.resolve;
        waiter.resolve = (line) => {
          clearTimeout(timer);
          originalResolve(line);
        };
      });
    },
    stop: async (signal = 'SIGTERM', { timeoutMs = EXIT_TIMEOUT_MS } = {}) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const outcome = await Promise.race([closed, timedOut]);
      clearTimeout(timer);
      if (outcome === 'timeout') {
        child.kill('SIGKILL');
        await exited;
        throw new Error(
          `${entry} did not exit within ${describeDuration(timeoutMs)} of ${signal}; killed it${output()}`,
        );
      }
      await exited;
      return child.exitCode;
    },
  };
};
