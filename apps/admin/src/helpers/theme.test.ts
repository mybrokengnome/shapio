import { describe, expect, it } from 'vitest';
import { hasSingleVariant, oppositeScheme, resolveScheme } from './theme';

const BOTH = ['light', 'dark'] as const;

describe('resolveScheme', () => {
  it('keeps an explicit appearance whatever the OS prefers', () => {
    expect(resolveScheme('light', BOTH, true)).toBe('light');
    expect(resolveScheme('dark', BOTH, false)).toBe('dark');
  });

  it('follows the OS for "system"', () => {
    expect(resolveScheme('system', BOTH, true)).toBe('dark');
    expect(resolveScheme('system', BOTH, false)).toBe('light');
  });

  it('renders a single-variant theme in its only variant, whatever the appearance', () => {
    for (const appearance of ['system', 'light', 'dark'] as const) {
      for (const systemDark of [true, false]) {
        expect(resolveScheme(appearance, ['dark'], systemDark)).toBe('dark');
        expect(resolveScheme(appearance, ['light'], systemDark)).toBe('light');
      }
    }
  });
});

describe('hasSingleVariant', () => {
  it('is true for one variant only', () => {
    expect(hasSingleVariant(['dark'])).toBe(true);
    expect(hasSingleVariant(BOTH)).toBe(false);
  });
});

describe('oppositeScheme', () => {
  it('flips light and dark', () => {
    expect(oppositeScheme('light')).toBe('dark');
    expect(oppositeScheme('dark')).toBe('light');
  });
});
