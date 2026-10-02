import { describe, expect, it } from 'vitest';
import { oppositeTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('keeps an explicit preference whatever the OS prefers', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('oppositeTheme', () => {
  it('flips light and dark', () => {
    expect(oppositeTheme('light')).toBe('dark');
    expect(oppositeTheme('dark')).toBe('light');
  });
});
