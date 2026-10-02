import { describe, expect, it, vi } from 'vitest';
import { createUsageAggregator, type UsageBatch } from './aggregator.js';

const log = { error: vi.fn(), warn: vi.fn() };
const AT = new Date('2026-10-02T10:00:00Z');

const setup = (options: { maxKeys?: number; write?: (batch: UsageBatch) => Promise<void> } = {}) => {
  const batches: UsageBatch[] = [];
  let clock = AT;
  const aggregator = createUsageAggregator({
    write:
      options.write ??
      ((batch) => {
        batches.push(batch);
        return Promise.resolve();
      }),
    flushIntervalMs: 3_600_000,
    ...(options.maxKeys !== undefined ? { maxKeys: options.maxKeys } : {}),
    log,
    now: () => clock,
  });
  return { aggregator, batches, setClock: (at: Date) => (clock = at) };
};

describe('usage aggregator', () => {
  it('adds up reads per (day, model, path, principal, selection) and requests per (day, principal)', async () => {
    const { aggregator, batches, setClock } = setup();
    aggregator.recordFieldReads('token:a', 'm1', [{ path: 'f1', selection: 'explicit' }]);
    aggregator.recordFieldReads('token:a', 'm1', [
      { path: 'f1', selection: 'explicit' },
      { path: 'f2', selection: 'implicit' },
    ]);
    aggregator.recordRequest('token:a', null);
    setClock(new Date('2026-10-02T11:00:00Z'));
    aggregator.recordRequest('token:a', 41);
    aggregator.recordRequest('anonymous', null);
    await aggregator.flush();

    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch?.fieldReads).toEqual([
      expect.objectContaining({ day: '2026-10-02', fieldPath: 'f1', reads: 2, selection: 'explicit' }),
      expect.objectContaining({ fieldPath: 'f2', reads: 1, selection: 'implicit' }),
    ]);
    expect(batch?.tokenReads).toEqual([
      expect.objectContaining({ principalKey: 'token:a', requests: 2, lastSnapshot: 41 }),
      expect.objectContaining({ principalKey: 'anonymous', requests: 1, lastSnapshot: null }),
    ]);
    expect(aggregator.size()).toBe(0);
    await aggregator.flush();
    expect(batches).toHaveLength(1);
  });

  it('buckets by UTC day', async () => {
    const { aggregator, batches, setClock } = setup();
    setClock(new Date('2026-10-01T23:59:59Z'));
    aggregator.recordFieldReads('anonymous', 'm1', [{ path: 'f1', selection: 'explicit' }]);
    setClock(new Date('2026-10-02T00:00:01Z'));
    aggregator.recordFieldReads('anonymous', 'm1', [{ path: 'f1', selection: 'explicit' }]);
    await aggregator.flush();
    expect(batches[0]?.fieldReads.map((row) => row.day)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('flushes early when it reaches the key cap', async () => {
    const { aggregator, batches } = setup({ maxKeys: 3 });
    aggregator.recordFieldReads('anonymous', 'm1', [
      { path: 'a', selection: 'explicit' },
      { path: 'b', selection: 'explicit' },
    ]);
    expect(batches).toHaveLength(0);
    aggregator.recordRequest('anonymous', null);
    aggregator.recordRequest('token:x', null);
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]?.fieldReads).toHaveLength(2);
  });

  it('keeps counters after a failed flush and writes them with the next one', async () => {
    let fail = true;
    const written: UsageBatch[] = [];
    const { aggregator } = setup({
      write: (batch) => {
        if (fail) {
          return Promise.reject(new Error('database down'));
        }
        written.push(batch);
        return Promise.resolve();
      },
    });
    aggregator.recordFieldReads('anonymous', 'm1', [{ path: 'a', selection: 'explicit' }]);
    await aggregator.flush();
    expect(log.warn).toHaveBeenCalled();
    aggregator.recordFieldReads('anonymous', 'm1', [{ path: 'a', selection: 'explicit' }]);
    fail = false;
    await aggregator.flush();
    expect(written[0]?.fieldReads).toEqual([expect.objectContaining({ fieldPath: 'a', reads: 2 })]);
  });

  it('writes what is left on close', async () => {
    const { aggregator, batches } = setup();
    aggregator.recordRequest('app_users', null);
    await aggregator.close();
    expect(batches[0]?.tokenReads).toEqual([
      expect.objectContaining({ principalKey: 'app_users', requests: 1 }),
    ]);
  });
});
