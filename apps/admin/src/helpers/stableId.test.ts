import { isStableId } from '@shapio/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newStableId } from './stableId';

describe('newStableId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a stable ID', () => {
    expect(isStableId(newStableId())).toBe(true);
  });

  it('falls back to getRandomValues outside secure contexts', () => {
    const real = globalThis.crypto;
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => real.getRandomValues(array),
    } as unknown as Crypto);
    const ids = new Set(Array.from({ length: 50 }, newStableId));
    expect(ids.size).toBe(50);
    expect([...ids].every(isStableId)).toBe(true);
  });
});
