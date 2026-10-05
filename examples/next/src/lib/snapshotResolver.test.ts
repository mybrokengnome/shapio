import { describe, expect, it, vi } from 'vitest';
import { cachedRead, createSnapshotResolver, DEV_WINDOW_MS } from './snapshotResolver';

const clock = (start = 0) => {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
};

describe('createSnapshotResolver', () => {
  it('pins the first snapshot for the whole build', async () => {
    const { now, advance } = clock();
    const current = vi.fn().mockResolvedValueOnce(7).mockResolvedValue(8);
    const snapshot = createSnapshotResolver({ dev: false, configured: undefined, current, now });

    expect(await snapshot()).toBe(7);
    advance(60 * 60 * 1000);
    expect(await snapshot()).toBe(7);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('reuses a dev read within the window and reads the current snapshot again after it', async () => {
    const { now, advance } = clock();
    const current = vi.fn().mockResolvedValueOnce(7).mockResolvedValue(8);
    const snapshot = createSnapshotResolver({ dev: true, configured: undefined, current, now });

    expect(await snapshot()).toBe(7);
    advance(DEV_WINDOW_MS - 1);
    expect(await snapshot()).toBe(7);
    expect(current).toHaveBeenCalledTimes(1);

    advance(1);
    expect(await snapshot()).toBe(8);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('keeps SHAPIO_SNAPSHOT in dev and in builds, without asking Shapio', async () => {
    const current = vi.fn().mockResolvedValue(8);
    for (const dev of [true, false]) {
      const snapshot = createSnapshotResolver({ dev, configured: 3, current });
      expect(await snapshot()).toBe(3);
    }
    expect(current).not.toHaveBeenCalled();
  });
});

describe('cachedRead', () => {
  it('shares one read between calls that overlap it', async () => {
    const read = vi.fn().mockResolvedValue('value');
    const cached = cachedRead(read, DEV_WINDOW_MS, clock().now);

    const [first, second] = await Promise.all([cached(), cached()]);
    expect([first, second]).toEqual(['value', 'value']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed read', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('value');
    const cached = cachedRead(read, Number.POSITIVE_INFINITY, clock().now);

    await expect(cached()).rejects.toThrow('down');
    expect(await cached()).toBe('value');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
