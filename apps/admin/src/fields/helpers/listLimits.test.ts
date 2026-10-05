import { describe, expect, it } from 'vitest';
import { emptyListMinimum, hasRoomFor } from './listLimits';

describe('hasRoomFor', () => {
  it('always has room without a max', () => {
    expect(hasRoomFor(0, undefined)).toBe(true);
    expect(hasRoomFor(500, undefined)).toBe(true);
  });

  it('has room below the max and none at or above it', () => {
    expect(hasRoomFor(0, 6)).toBe(true);
    expect(hasRoomFor(5, 6)).toBe(true);
    expect(hasRoomFor(6, 6)).toBe(false);
    expect(hasRoomFor(7, 6)).toBe(false);
  });
});

describe('emptyListMinimum', () => {
  it('says nothing without a min, or with a min of 1', () => {
    expect(emptyListMinimum(undefined)).toBeUndefined();
    expect(emptyListMinimum(0)).toBeUndefined();
    expect(emptyListMinimum(1)).toBeUndefined();
  });

  it('names a min of 2 or more, which one item does not meet', () => {
    expect(emptyListMinimum(2)).toBe(2);
    expect(emptyListMinimum(5)).toBe(5);
  });
});
