import { THEME_VARIANTS, type ThemeVariant } from '@shapio/schema';
import type { ThemeDefinition, ThemeTokens } from './public.js';

/**
 * Extension themes for the admin (docs/plans/themes.md): built once at startup from `shapio.config`
 * `themes`, already validated (keys match THEME_KEY_PATTERN, values THEME_COLOUR_PATTERN, so nothing here
 * can escape a declaration). The stylesheet uses the selectors of the built-in theme files:
 * `[data-theme='<key>']` for the light (or only) variant and `[data-theme='<key>'].dark` for the dark one.
 */
export type ThemeSummary = {
  key: string;
  name: string;
  description: string | undefined;
  variants: ThemeVariant[];
};

export type ThemeCatalogue = { items: ThemeSummary[]; stylesheet: string };

const block = (selector: string, tokens: ThemeTokens) =>
  `${selector} {\n${Object.entries(tokens)
    .map(([token, value]) => `  --${token}: ${value};`)
    .join('\n')}\n}\n`;

const variantsOf = (theme: ThemeDefinition): ThemeVariant[] =>
  THEME_VARIANTS.filter((variant) => theme[variant] !== undefined);

const themeCss = (theme: ThemeDefinition) => {
  const variants = variantsOf(theme);
  return variants
    .map((variant) => {
      const tokens = theme[variant] ?? {};
      const selector =
        variant === 'dark' && variants.length > 1
          ? `[data-theme='${theme.key}'].dark`
          : `[data-theme='${theme.key}']`;
      return block(selector, tokens);
    })
    .join('\n');
};

export const buildThemeCatalogue = (themes: readonly ThemeDefinition[]): ThemeCatalogue => ({
  items: themes.map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    variants: variantsOf(theme),
  })),
  stylesheet:
    themes.length > 0
      ? `/* Shapio extension themes (shapio.config) */\n${themes.map(themeCss).join('\n')}`
      : '',
});
