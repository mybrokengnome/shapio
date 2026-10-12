import { describe, expect, it } from 'vitest';
import { formatTokenNames } from './tokenNames';

const token = (name: string) => ({ id: name, name, siteId: null });

describe('formatTokenNames', () => {
  it('quotes each name and joins them as a list', () => {
    expect(formatTokenNames([token('Production build')], 'en')).toBe('“Production build”');
    expect(formatTokenNames([token('A'), token('B'), token('C')], 'en')).toBe('“A”, “B”, and “C”');
  });
});
