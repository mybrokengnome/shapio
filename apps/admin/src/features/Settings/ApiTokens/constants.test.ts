import { describe, expect, it } from 'vitest';
import { expiryToDate } from './constants';

describe('expiryToDate', () => {
  it('adds whole days', () => {
    expect(expiryToDate('30', new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-31T00:00:00.000Z');
  });

  it('returns null for never', () => {
    expect(expiryToDate('never')).toBeNull();
  });
});
