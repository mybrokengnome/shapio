import { describe, expect, it } from 'vitest';
import { lockKeyFromId } from './advisoryLocks.js';

describe('lockKeyFromId', () => {
  it('is stable and fits a signed int4', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const key = lockKeyFromId(id);
    expect(lockKeyFromId(id)).toBe(key);
    expect(Number.isInteger(key)).toBe(true);
    expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(key).toBeLessThan(2 ** 31);
    expect(lockKeyFromId('another-id')).not.toBe(key);
  });
});
