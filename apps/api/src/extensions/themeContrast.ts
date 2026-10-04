import { checkThemeContrast, THEME_VARIANTS } from '@shapio/schema';
import type { ThemeDefinition } from './public.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * WCAG AA warnings for extension themes (`shapio extensions check`): the pairs the built-in themes are held
 * to. Warnings, not errors: a project may knowingly ship a theme that fails. Only `#rrggbb` values can be
 * measured; a variant with other values is reported as not fully checked.
 */
export const themeContrastWarnings = (themes: readonly ThemeDefinition[]): string[] =>
  themes.flatMap((theme) =>
    THEME_VARIANTS.flatMap((variant) => {
      const tokens = theme[variant];
      if (!tokens) {
        return [];
      }
      const values: Record<string, string> = Object.fromEntries(
        Object.entries(tokens).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      const failures = checkThemeContrast(values, variant)
        .filter(({ ratio, required }) => ratio !== undefined && ratio < required)
        .map(
          ({ foreground, background, ratio, required }) =>
            `${theme.key} (${variant}): --${foreground} on --${background} is ${(ratio ?? 0).toFixed(2)}:1, needs ${required}:1`,
        );
      const unmeasured = Object.values(values).some((value) => !HEX.test(value))
        ? [`${theme.key} (${variant}): only #rrggbb values are checked for contrast`]
        : [];
      return [...failures, ...unmeasured];
    }),
  );
