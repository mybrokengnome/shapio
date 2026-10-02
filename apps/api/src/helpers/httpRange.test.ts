import { describe, expect, it } from 'vitest';
import { parseByteRange } from './httpRange.js';

describe('parseByteRange', () => {
  it.each([
    [undefined, 100, undefined],
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=90-', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=-500', 100, { start: 0, end: 99 }],
    ['bytes=50-500', 100, { start: 50, end: 99 }],
    ['bytes=100-', 100, 'unsatisfiable'],
    ['bytes=9-3', 100, 'unsatisfiable'],
    ['bytes=-0', 100, 'unsatisfiable'],
    ['bytes=0-1,5-6', 100, undefined],
    ['items=0-1', 100, undefined],
  ])('%j of %d bytes → %j', (header, size, expected) => {
    expect(parseByteRange(header, size)).toEqual(expected);
  });
});
