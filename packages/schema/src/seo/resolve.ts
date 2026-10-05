import type { SeoLocaleDefaults } from './defaults.js';
import type { SeoFieldKey } from './ids.js';
import { applyTitleTemplate } from './locale.js';

/** The API IDs under which a delivered SEO value carries each built-in field (absent: removed or retyped). */
export type SeoKeys = Partial<Record<SeoFieldKey, string>>;

/** The API IDs the built-in component is created with. */
export const DEFAULT_SEO_KEYS: Required<SeoKeys> = {
  title: 'title',
  description: 'description',
  image: 'image',
  canonical: 'canonical',
  noindex: 'noindex',
};

export type ResolveSeoContext = {
  /** The site's default texts for the entry's locale (`seoDefaultsForLocale`). */
  defaults: SeoLocaleDefaults;
  /** The default social image in the delivered asset shape, or null. */
  image: unknown;
  /** The entry's own title (its title field) when the SEO title is empty; null when none is readable. */
  fallbackTitle: string | null;
  /** Where each field sits in `raw`; defaults to the built-in API IDs. */
  keys?: SeoKeys;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * The effective SEO values of one delivered entry, in the same shape as the raw value (plan seo-fields): the
 * title is the entry's SEO title, else its own title, through the site's template (the bare site name when
 * neither exists, never templated); description and image fall back to the site's defaults; canonical stays
 * the entry's value or null; noindex is a boolean. Other keys (fields a user added) pass through. Pure.
 */
export const resolveSeo = (raw: unknown, context: ResolveSeoContext): Record<string, unknown> => {
  const keys = context.keys ?? DEFAULT_SEO_KEYS;
  const output: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  const value = (key: SeoFieldKey) => (keys[key] === undefined ? undefined : output[keys[key]]);
  const set = (key: SeoFieldKey, next: unknown) => {
    if (keys[key] !== undefined) {
      output[keys[key]] = next;
    }
  };
  const base = text(value('title')) ?? text(context.fallbackTitle);
  set(
    'title',
    base !== null
      ? applyTitleTemplate(base, context.defaults.titleTemplate)
      : (context.defaults.siteName ?? null),
  );
  set('description', text(value('description')) ?? context.defaults.description ?? null);
  set('image', value('image') ?? context.image ?? null);
  set('canonical', text(value('canonical')));
  set('noindex', value('noindex') === true);
  return output;
};
