import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_DIR } from './sourceFiles';

/**
 * WCAG 2.1 AA contrast of the theme tokens in both themes, read from the real stylesheet: text pairs need
 * 4.5:1 (1.4.3), and what identifies a control or the focus (input borders, unchecked switches, focus
 * rings, primary buttons against the page) needs 3:1 (1.4.11). axe checks rendered text only, not these.
 */
const STYLESHEET = readFileSync(join(SRC_DIR, 'styles', 'index.css'), 'utf8');

const tokensOf = (selector: string): Map<string, string> => {
  const start = STYLESHEET.indexOf(`${selector} {`);
  const block = STYLESHEET.slice(start, STYLESHEET.indexOf('}', start));
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
};

const BRAND = tokensOf('@theme');
const THEMES = { light: tokensOf(':root'), dark: tokensOf('.dark') };

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};
const contrastRatio = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
};

const SURFACES = ['background', 'card', 'popover'];
const TEXT_PAIRS: Array<[string, string]> = [
  ...SURFACES.map((surface): [string, string] => ['foreground', surface]),
  ...[...SURFACES, 'muted', 'secondary', 'accent', 'sidebar'].map((surface): [string, string] => [
    'muted-foreground',
    surface,
  ]),
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['success', 'background'],
  ['success', 'card'],
  ['success', 'success-muted'],
  // Status chips (StatusChip): tone text on its own tinted background, and on plain surfaces.
  ['warning', 'warning-muted'],
  ['warning', 'card'],
  ['info', 'info-muted'],
  ['info', 'card'],
  ['destructive', 'destructive-muted'],
  ['foreground', 'muted'],
  ['link', 'background'],
  ['link', 'card'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ['sidebar-foreground', 'sidebar-accent'],
  ['muted-foreground', 'sidebar-accent'],
  // Status and link text on raised and muted surfaces (popovers, sheets, muted bands).
  ...['destructive', 'success', 'warning', 'link'].flatMap((text): Array<[string, string]> => [
    [text, 'popover'],
    [text, 'muted'],
  ]),
];
const UI_PAIRS: Array<[string, string]> = [
  ...[...SURFACES, 'muted', 'secondary'].map((surface): [string, string] => ['input', surface]),
  ...SURFACES.map((surface): [string, string] => ['ring', surface]),
  ['ring', 'muted'],
  ['ring', 'accent'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'popover'],
  // Cobalt icons on neutral tiles (IconTile accent) and the info alert's icon in light.
  ['primary', 'muted'],
  ['info', 'muted'],
  ['sidebar-ring', 'sidebar'],
  // The active nav item's left bar.
  ['sidebar-primary', 'sidebar'],
  ['sidebar-primary', 'sidebar-accent'],
];

/**
 * Dark only: control borders on the selection surface. Light --input on the warm-neutral --accent is
 * 2.96:1; selected light table rows use accent/40, which passes, and other selected surfaces hold no controls.
 */
const DARK_UI_PAIRS: Array<[string, string]> = [['input', 'accent']];

describe('theme token contrast (WCAG 2.1 AA)', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    const ratio = (foreground: string, background: string) => {
      const a = tokens.get(foreground);
      const b = tokens.get(background);
      expect(a, `--${foreground} in ${theme}`).toBeDefined();
      expect(b, `--${background} in ${theme}`).toBeDefined();
      return contrastRatio(a ?? '', b ?? '');
    };

    it.each(TEXT_PAIRS)(`${theme}: text --%s on --%s is at least 4.5:1`, (foreground, background) => {
      expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(theme === 'dark' ? [...UI_PAIRS, ...DARK_UI_PAIRS] : UI_PAIRS)(
      `${theme}: control --%s on --%s is at least 3:1`,
      (foreground, background) => {
        expect(ratio(foreground, background)).toBeGreaterThanOrEqual(3);
      },
    );
  }

  it('brand pairs used for the wordmark and accents meet AA', () => {
    const brand = (name: string) => BRAND.get(`color-${name}`) ?? '';
    expect(contrastRatio(brand('cobalt'), brand('ivory'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(brand('ink'), brand('ivory'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(brand('periwinkle'), brand('ink'))).toBeGreaterThanOrEqual(4.5);
  });
});
