import { describe, expect, it } from 'vitest';
import { selectionRange } from './selectionRange';

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('selectionRange', () => {
  it('spans from the anchor to the target, in either direction', () => {
    expect(selectionRange(IDS, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectionRange(IDS, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(selectionRange(IDS, 'c', 'c')).toEqual(['c']);
  });

  it('has no range without an anchor that is still listed', () => {
    expect(selectionRange(IDS, undefined, 'c')).toBeUndefined();
    expect(selectionRange(IDS, 'gone', 'c')).toBeUndefined();
  });
});
