import type { ThemeVariant } from './tokens.js';

/**
 * WCAG 2.1 AA contrast of a theme's tokens: text pairs need 4.5:1 (1.4.3); what identifies a control or the
 * focus (input borders, unchecked switches, focus rings, primary buttons against the page) needs 3:1 (1.4.11).
 * The admin's built-in themes are gated on this by a unit test; extension themes get warnings from
 * `shapio extensions check`. axe checks rendered text only, not these pairs.
 */
export type ContrastPair = readonly [foreground: string, background: string];

const SURFACES = ['background', 'card', 'popover'];

export const THEME_TEXT_PAIRS: readonly ContrastPair[] = [
  ...SURFACES.map((surface): ContrastPair => ['foreground', surface]),
  ...[...SURFACES, 'muted', 'secondary', 'accent', 'sidebar'].map((surface): ContrastPair => [
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
  ...['destructive', 'success', 'warning', 'link'].flatMap((text): ContrastPair[] => [
    [text, 'popover'],
    [text, 'muted'],
  ]),
  // The signed-out screens' brand panel (tagline and pitch on both ends of the gradient).
  ['brand-panel-foreground', 'brand-panel-from'],
  ['brand-panel-foreground', 'brand-panel-to'],
];

export const THEME_UI_PAIRS: readonly ContrastPair[] = [
  ...[...SURFACES, 'muted', 'secondary'].map((surface): ContrastPair => ['input', surface]),
  ...SURFACES.map((surface): ContrastPair => ['ring', surface]),
  ['ring', 'muted'],
  ['ring', 'accent'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'popover'],
  // Primary icons on neutral tiles (IconTile accent) and the info alert's icon.
  ['primary', 'muted'],
  ['info', 'muted'],
  ['sidebar-ring', 'sidebar'],
  // The active nav item's left bar.
  ['sidebar-primary', 'sidebar'],
  ['sidebar-primary', 'sidebar-accent'],
];

/**
 * Dark only: control borders on the selection surface. In light, selected table rows use accent/40, which
 * passes, and other selected surfaces hold no controls.
 */
export const THEME_DARK_UI_PAIRS: readonly ContrastPair[] = [['input', 'accent']];

const HEX = /^#[0-9a-fA-F]{6}$/;

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};

/** The WCAG contrast ratio of two `#rrggbb` colours. */
export const contrastRatio = (a: string, b: string): number => {
  const [high = 0, low = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

export type ContrastCheck = {
  foreground: string;
  background: string;
  /** 4.5 for text, 3 for controls. */
  required: number;
  /** Undefined when a value is not a `#rrggbb` colour (functions such as `oklch()` are not checked). */
  ratio: number | undefined;
};

/** Every pair the variant must meet, with its ratio. Missing tokens report an undefined ratio. */
export const checkThemeContrast = (
  tokens: Readonly<Record<string, string>>,
  variant: ThemeVariant,
): ContrastCheck[] => {
  const uiPairs = variant === 'dark' ? [...THEME_UI_PAIRS, ...THEME_DARK_UI_PAIRS] : THEME_UI_PAIRS;
  const measure = ([foreground, background]: ContrastPair, required: number): ContrastCheck => {
    const a = tokens[foreground];
    const b = tokens[background];
    return {
      foreground,
      background,
      required,
      ratio: a && b && HEX.test(a) && HEX.test(b) ? contrastRatio(a, b) : undefined,
    };
  };
  return [...THEME_TEXT_PAIRS.map((pair) => measure(pair, 4.5)), ...uiPairs.map((pair) => measure(pair, 3))];
};
