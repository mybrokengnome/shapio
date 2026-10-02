import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './formatDate';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const relative = (iso: string) => formatRelativeTime(iso, { now: NOW, language: 'en' });

describe('formatRelativeTime', () => {
  it('picks the largest readable unit', () => {
    expect(relative('2026-10-02T11:59:30Z')).toBe('30 sec. ago');
    expect(relative('2026-10-02T11:15:00Z')).toBe('45 min. ago');
    expect(relative('2026-10-02T10:00:00Z')).toBe('2 hr. ago');
    expect(relative('2026-10-01T12:00:00Z')).toBe('yesterday');
    expect(relative('2026-09-18T12:00:00Z')).toBe('2 wk. ago');
    expect(relative('2026-06-02T12:00:00Z')).toBe('4 mo. ago');
    expect(relative('2024-10-02T12:00:00Z')).toBe('2 yr. ago');
  });

  it('handles the future', () => {
    expect(relative('2026-10-05T12:00:00Z')).toBe('in 3 days');
  });

  it('is empty for missing or invalid input', () => {
    expect(relative('')).toBe('');
    expect(formatRelativeTime(null)).toBe('');
    expect(relative('not a date')).toBe('');
  });
});
