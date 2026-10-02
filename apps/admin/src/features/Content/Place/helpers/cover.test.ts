import { describe, expect, it } from 'vitest';
import { coverAssetOf } from './cover';

describe('coverAssetOf', () => {
  it('reads an asset view and ignores empty or unexpected values', () => {
    const asset = { id: 'a', mimeType: 'image/png', url: '/a.png', variants: [] };
    expect(coverAssetOf(asset)).toBe(asset);
    expect(coverAssetOf(null)).toBeUndefined();
    expect(coverAssetOf('a')).toBeUndefined();
    expect(coverAssetOf({ id: 'a' })).toBeUndefined();
  });
});
