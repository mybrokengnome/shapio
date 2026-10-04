/**
 * Admin themes (docs/plans/themes.md): a theme is a named, complete set of these tokens for a light variant, a
 * dark variant or both. One list, shared by the admin's stylesheets (and their tests) and the API, which
 * validates themes declared by extensions (`shapio.config` `themes`).
 */
/** The UI tokens: every theme variant sets all of them. */
export const THEME_SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'primary-hover',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'destructive-muted',
  'success',
  'success-muted',
  'warning',
  'warning-muted',
  'info',
  'info-muted',
  'border',
  'input',
  'ring',
  'link',
  'overlay',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const;

/**
 * The logo (tile, S, letters) and the signed-out screens' brand panel. Built-in themes set them all; an
 * extension theme may leave them out and gets Shapio's for that variant.
 */
export const THEME_BRAND_TOKENS = [
  'brand-logo',
  'brand-logo-foreground',
  'brand-letters',
  'brand-panel-from',
  'brand-panel-to',
  'brand-panel-foreground',
  'brand-panel-mark',
] as const;

export const THEME_TOKENS = [...THEME_SEMANTIC_TOKENS, ...THEME_BRAND_TOKENS] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export const THEME_VARIANTS = ['light', 'dark'] as const;

export type ThemeVariant = (typeof THEME_VARIANTS)[number];

/** A theme key: used in `data-theme` and in CSS selectors, so deliberately narrow. */
export const THEME_KEY_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

/** The themes the admin ships; an extension theme may not reuse these keys. */
export const BUILT_IN_THEME_KEYS = ['shapio', 'classic', 'murdered-out', 'snowed'] as const;

export type BuiltInThemeKey = (typeof BUILT_IN_THEME_KEYS)[number];

/**
 * A token value an extension may use: a hex colour or a colour function whose arguments are numbers, units
 * and separators only (no `;`, quotes, braces or nested functions such as `url()` or `var()`), so a value
 * can never escape its declaration.
 */
export const THEME_COLOUR_PATTERN =
  /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?|oklch|oklab)\([0-9a-z.,%\s/+-]{1,80}\))$/;
