import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMain } from './runMain.js';

describe('runMain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('reports a failure thrown before the entry point returns its promise in one line', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() =>
      runMain(() => {
        throw new Error('env/PORT must be integer');
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(stderr).toHaveBeenCalledWith('shapio: Error: env/PORT must be integer\n');
  });

  it('reports a rejected entry point the same way', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    runMain(() => Promise.reject(new Error('no database')));
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(stderr).toHaveBeenCalledWith('shapio: Error: no database\n');
  });
});
