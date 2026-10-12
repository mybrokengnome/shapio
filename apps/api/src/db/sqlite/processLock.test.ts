import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireProcessLock, SqliteFileInUseError } from './processLock.js';

describe('acquireProcessLock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shapio-process-lock-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('holds the file until released; a second holder is refused meanwhile', () => {
    const path = join(directory, 'shapio.db');
    const first = acquireProcessLock(`sqlite:${path}`);
    expect(existsSync(`${path}-shapio.lock`)).toBe(true);
    expect(existsSync(`${path}-shapio.lock-journal`)).toBe(false);
    expect(() => acquireProcessLock(`sqlite:${path}`)).toThrow(SqliteFileInUseError);
    expect(() => acquireProcessLock(`sqlite:${path}`)).toThrow(/Another Shapio process already serves/);
    first.release();
    const again = acquireProcessLock(`sqlite:${path}`);
    again.release();
  });

  it('takes no lock for an in-memory database, PostgreSQL or MySQL', () => {
    for (const url of ['sqlite::memory:', 'postgres://localhost/shapio', 'mysql://localhost/shapio']) {
      const one = acquireProcessLock(url);
      const two = acquireProcessLock(url);
      one.release();
      two.release();
    }
  });
});
