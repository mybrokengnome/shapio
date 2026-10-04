import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkThemeContrast, THEME_TOKENS, type ThemeVariant } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '@/constants/themes';
import { SRC_DIR } from './sourceFiles';

/**
 * WCAG 2.1 AA contrast of every built-in theme and variant, read from the real stylesheets
 * (styles/themes/<key>.css). The pairs live in @shapio/schema (themes/contrast.ts), shared with
 * `shapio extensions check`. axe checks rendered text only, not these pairs.
 */
const readTheme = (key: string) => readFileSync(join(SRC_DIR, 'styles', 'themes', `${key}.css`), 'utf8');

/** The custom properties of the block whose selector list contains `selector` exactly. */
const tokensOf = (css: string, selector: string): Map<string, string> => {
  const block = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, selectors]) =>
    (selectors ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  );
  return new Map(
    [...(block?.[2] ?? '').matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
  );
};

const variantSelector = (key: string, variant: ThemeVariant, variants: readonly ThemeVariant[]) =>
  variant === 'dark' && variants.length > 1 ? `[data-theme='${key}'].dark` : `[data-theme='${key}']`;

const VARIANTS = BUILT_IN_THEMES.flatMap(({ key, variants }) =>
  variants.map((variant) => ({
    name: `${key} ${variant}`,
    variant,
    tokens: tokensOf(readTheme(key), variantSelector(key, variant, variants)),
  })),
);

describe('built-in theme tokens', () => {
  it.each(VARIANTS)('$name defines exactly the shared token list', ({ tokens }) => {
    expect([...tokens.keys()].sort()).toEqual([...THEME_TOKENS].sort());
  });

  it.each(VARIANTS)('$name uses #rrggbb values only (so every pair is measurable)', ({ tokens }) => {
    expect([...tokens.values()].filter((value) => !/^#[0-9a-f]{6}$/.test(value))).toEqual([]);
  });

  it('falls back to Shapio (zero specificity) when no theme or an unknown theme is set', () => {
    const css = readTheme('shapio');
    expect(tokensOf(css, ':where(:root)')).toEqual(tokensOf(css, "[data-theme='shapio']"));
  });
});

describe('theme token contrast (WCAG 2.1 AA)', () => {
  for (const { name, variant, tokens } of VARIANTS) {
    const checks = checkThemeContrast(Object.fromEntries(tokens), variant).map((check) => ({
      ...check,
      label: `${name}: --${check.foreground} on --${check.background} is at least ${check.required}:1`,
    }));
    it.each(checks)('$label', ({ ratio, required }) => {
      expect(ratio).toBeDefined();
      expect(ratio ?? 0).toBeGreaterThanOrEqual(required);
    });
  }
});
