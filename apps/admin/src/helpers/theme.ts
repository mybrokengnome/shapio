import type { ThemeVariant } from '@shapio/schema';

/**
 * The variant actually rendered: the saved one when the theme has it, else the theme's first. Nothing follows
 * the operating system. public/theme-init.js repeats this before first paint (test/themeInit.test.ts keeps
 * the two in step).
 */
export const resolveScheme = (appearance: ThemeVariant, variants: readonly ThemeVariant[]): ThemeVariant =>
  variants.includes(appearance) ? appearance : (variants[0] ?? appearance);

/** A look is one variant of one theme; its radio value is `<theme key>:<variant>` (keys never hold a colon). */
export const lookValue = (theme: string, variant: ThemeVariant) => `${theme}:${variant}`;
