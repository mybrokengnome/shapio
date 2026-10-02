import { describe, expect, it } from 'vitest';
import { fromDateTimeInput, toDateTimeInput } from './dates';
import { slugify } from './slugify';

describe('slugify', () => {
  it('makes lower-case hyphenated slugs without accents or punctuation', () => {
    expect(slugify('  Crème Brûlée: 2026 Edition! ')).toBe('creme-brulee-2026-edition');
    expect(slugify('---')).toBe('');
  });
});

describe('datetime conversion', () => {
  it('round-trips canonical UTC text through the UTC input format', () => {
    expect(toDateTimeInput('2026-10-01T08:05:09.000Z', true)).toBe('2026-10-01T08:05:09');
    expect(fromDateTimeInput('2026-10-01T08:05', true)).toBe('2026-10-01T08:05:00.000Z');
    expect(fromDateTimeInput('', true)).toBeNull();
    expect(toDateTimeInput('nonsense', true)).toBe('');
  });
});
