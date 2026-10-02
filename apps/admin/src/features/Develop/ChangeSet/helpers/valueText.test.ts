import { describe, expect, it } from 'vitest';
import { valueText } from './valueText';

describe('valueText', () => {
  it('reads empty values as empty text', () => {
    expect(valueText(null)).toBe('');
    expect(valueText(undefined)).toBe('');
  });

  it('keeps strings and prints scalars', () => {
    expect(valueText('Hello')).toBe('Hello');
    expect(valueText(42)).toBe('42');
    expect(valueText(false)).toBe('false');
  });

  it('prints structured values as compact JSON, cut at 240 characters', () => {
    expect(valueText({ type: 'doc' })).toBe('{"type":"doc"}');
    const long = valueText('x'.repeat(500));
    expect(long).toHaveLength(240);
    expect(long.endsWith('…')).toBe(true);
  });
});
