import { describe, expect, it } from 'vitest';
import { lookValue, resolveScheme } from './theme';

describe('resolveScheme', () => {
  it('renders the saved variant when the theme has it', () => {
    expect(resolveScheme('light', ['light', 'dark'])).toBe('light');
    expect(resolveScheme('dark', ['light', 'dark'])).toBe('dark');
    expect(resolveScheme('dark', ['dark'])).toBe('dark');
  });

  it("falls back to the theme's first variant when it lost the saved one", () => {
    expect(resolveScheme('light', ['dark'])).toBe('dark');
    expect(resolveScheme('dark', ['light'])).toBe('light');
  });
});

describe('lookValue', () => {
  it('names one variant of one theme', () => {
    expect(lookValue('murdered-out', 'dark')).toBe('murdered-out:dark');
  });
});
