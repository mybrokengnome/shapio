import type { BuiltInThemeKey, ThemeVariant } from '@shapio/schema';

/** What the person picks beside the theme: follow the OS, or force a variant (if the theme has it). */
export const APPEARANCES = ['system', 'light', 'dark'] as const;

export type Appearance = (typeof APPEARANCES)[number];

export const isAppearance = (value: string): value is Appearance =>
  (APPEARANCES as readonly string[]).includes(value);

export type BuiltInThemeMeta = {
  key: BuiltInThemeKey;
  /** The variants the theme defines (styles/themes/<key>.css); one means it ignores the appearance. */
  variants: readonly ThemeVariant[];
};

/** The admin's own themes, in menu order. Names and descriptions: `appearance.themes.<key>.*`. */
export const BUILT_IN_THEMES: readonly BuiltInThemeMeta[] = [
  { key: 'shapio', variants: ['light', 'dark'] },
  { key: 'classic', variants: ['light', 'dark'] },
  { key: 'murdered-out', variants: ['dark'] },
  { key: 'snowed', variants: ['light'] },
];

export const DEFAULT_THEME_KEY: BuiltInThemeKey = 'shapio';

export const BOTH_VARIANTS: readonly ThemeVariant[] = ['light', 'dark'];
