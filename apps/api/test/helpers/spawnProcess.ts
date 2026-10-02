import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { API_ROOT } from './env.js';

export type LogLine = { msg?: string; level?: number } & Record<string, unknown>;

export type SpawnedProcess = {
  child: ChildProcess;
  pid: number;
  logs: LogLine[];
  /** Resolves with the first log line matching `predicate` (or rejects after `timeoutMs` / on exit). */
  waitForLog: (predicate: (line: LogLine) => boolean, timeoutMs?: number) => Promise<LogLine>;
  /** Sends `signal` and resolves with the exit code (null when killed by a signal). */
  stop: (signal?: NodeJS.Signals) => Promise<number | null>;
};

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

  return {
    child,
    pid: child.pid,
    logs,
    waitForLog: (predicate, timeoutMs = 20_000) => {
      const existing = logs.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.add(waiter);
        const fail = (reason: string) => {
          waiters.delete(waiter);
          reject(
            new Error(
              `${reason}\nstderr:\n${stderr.join('')}\nlogs:\n${logs.map((l) => JSON.stringify(l)).join('\n')}`,
            ),
          );
        };
        const timer = setTimeout(() => fail(`Timed out waiting for log line from ${entry}`), timeoutMs);
        void exited.then(([code]) => {
          if (waiters.has(waiter)) {
            clearTimeout(timer);
            fail(`${entry} exited with code ${String(code)} before the expected log line`);
          }
        });
        const originalResolve = waiter.resolve;
        waiter.resolve = (line) => {
          clearTimeout(timer);
          originalResolve(line);
        };
      });
    },
    stop: async (signal = 'SIGTERM') => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return child.exitCode;
      }
      child.kill(signal);
      const [code] = await exited;
      return code;
    },
  };
};
