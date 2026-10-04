import type { ThemeVariant } from '@shapio/schema';
import type { Appearance } from '@/constants/themes';

/**
 * The variant actually rendered: the appearance (the OS's for "system") when the theme has that variant,
 * else the theme's only variant. public/theme-init.js repeats this before first paint (test/themeInit.test.ts
 * keeps the two in step).
 */
export const resolveScheme = (
  appearance: Appearance,
  variants: readonly ThemeVariant[],
  systemPrefersDark: boolean,
): ThemeVariant => {
  const preferred: ThemeVariant =
    appearance === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearance;
  return variants.includes(preferred) ? preferred : (variants[0] ?? preferred);
};

/** A theme with one variant ignores the appearance setting. */
export const hasSingleVariant = (variants: readonly ThemeVariant[]) => variants.length === 1;

/** The explicit appearance a one-click switch moves to: the opposite of what is rendered now. */
export const oppositeScheme = (scheme: ThemeVariant): ThemeVariant => (scheme === 'dark' ? 'light' : 'dark');
