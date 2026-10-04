import type { BuiltInThemeKey, ThemeVariant } from '@shapio/schema';

export type BuiltInThemeMeta = {
  key: BuiltInThemeKey;
  /** The one variant the theme defines (styles/themes/<key>.css): every built-in theme is a single look. */
  variants: readonly ThemeVariant[];
};

/** The admin's own looks, in menu order: dark, then light. Names and descriptions: `appearance.themes.<key>.*`. */
export const BUILT_IN_THEMES: readonly BuiltInThemeMeta[] = [
  { key: 'shapio', variants: ['dark'] },
  { key: 'classic', variants: ['dark'] },
  { key: 'murdered-out', variants: ['dark'] },
  { key: 'forest', variants: ['dark'] },
  { key: 'snowed', variants: ['light'] },
  { key: 'butter', variants: ['light'] },
];

export const DEFAULT_THEME_KEY: BuiltInThemeKey = 'shapio';

export const DEFAULT_THEME_VARIANTS: readonly ThemeVariant[] = ['dark'];
