import type { Locale } from '@shapio/client';
import {
  resolveSeo,
  seoComponentDefinition,
  seoDefaultsForLocale,
  SEO_DESCRIPTION_SOFT_MAX,
  SEO_FIELD_IDS,
  SEO_TITLE_SOFT_MAX,
  type ComponentDefinition,
  type SeoDefaults,
  type SeoFieldKey,
  type SeoKeys,
} from '@shapio/schema';

/** A counter shows once the text is this close to its soft maximum (and stays while it is over). */
export const SEO_COUNTER_WINDOW = 10;

const SOFT_MAX_BY_FIELD_ID: Readonly<Record<string, number>> = {
  [SEO_FIELD_IDS.title]: SEO_TITLE_SOFT_MAX,
  [SEO_FIELD_IDS.description]: SEO_DESCRIPTION_SOFT_MAX,
};

export type SeoCounter = { count: number; max: number; over: boolean };

/**
 * The length counter under the SEO title or description (by stable field ID), or null when hidden: the field
 * has no soft maximum, or its text is more than `SEO_COUNTER_WINDOW` characters short of it.
 */
export const seoCounterOf = (fieldId: string, value: unknown): SeoCounter | null => {
  const max = SOFT_MAX_BY_FIELD_ID[fieldId];
  if (max === undefined) {
    return null;
  }
  const count = typeof value === 'string' ? [...value].length : 0;
  return count >= max - SEO_COUNTER_WINDOW ? { count, max, over: count > max } : null;
};

const BUILT_IN_TYPES = new Map(seoComponentDefinition().fields.map((field) => [field.id, field.type]));

/**
 * Where each built-in SEO field sits in a value of `component` (its API IDs may have been renamed): looked
 * up by stable ID; a removed or retyped field is left out, like the server's resolver does.
 */
export const seoKeysOf = (component: ComponentDefinition): SeoKeys => {
  const keys: SeoKeys = {};
  for (const [key, id] of Object.entries(SEO_FIELD_IDS) as [SeoFieldKey, string][]) {
    const field = component.fields.find((candidate) => candidate.id === id && !candidate.deprecated);
    if (field && field.type === BUILT_IN_TYPES.get(id)) {
      keys[key] = field.apiKey;
    }
  }
  return keys;
};

/** The locale, its configured fallbacks, then the default locale: the order delivery reads them in. */
export const localeChainOf = (locales: readonly Locale[], code: string | null): string[] => {
  const fallbackLocale = locales.find((locale) => locale.isDefault)?.code;
  const start = code ?? fallbackLocale;
  const configured = locales.find((locale) => locale.code === start)?.fallbacks ?? [];
  const chain = [start, ...configured, fallbackLocale].filter(
    (entry): entry is string => entry !== undefined && locales.some((locale) => locale.code === entry),
  );
  return chain.filter((entry, index) => chain.indexOf(entry) === index);
};

export type SeoPreview = {
  /** The title as search results show it (through the site's template), or null when there is none. */
  title: string | null;
  description: string | null;
  /** The site's name for the result's URL line, when the defaults set one. */
  siteName: string | null;
};

type SeoPreviewInput = {
  value: unknown;
  component: ComponentDefinition;
  defaults: SeoDefaults;
  localeChain: readonly string[];
  /** The entry's own title, used when the SEO title is empty. */
  fallbackTitle: unknown;
};

/** What a search result would show for this SEO value: the same rules as delivery's `seo=resolved`. */
export const seoPreviewOf = ({
  value,
  component,
  defaults,
  localeChain,
  fallbackTitle,
}: SeoPreviewInput): SeoPreview => {
  const keys = seoKeysOf(component);
  const localeDefaults = seoDefaultsForLocale(defaults, localeChain);
  const resolved = resolveSeo(value, {
    defaults: localeDefaults,
    image: null,
    fallbackTitle: typeof fallbackTitle === 'string' ? fallbackTitle : null,
    keys,
  });
  const text = (key: SeoFieldKey) => {
    const entry = keys[key] === undefined ? undefined : resolved[keys[key]];
    return typeof entry === 'string' && entry.trim() !== '' ? entry : null;
  };
  return {
    title: keys.title === undefined ? null : text('title'),
    description: text('description'),
    siteName: localeDefaults.siteName ?? null,
  };
};
