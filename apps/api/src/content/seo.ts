import {
  effectiveTitleField,
  isSeoField,
  resolveSeo,
  SEO_COMPONENT_ID,
  SEO_FIELD_IDS,
  seoDefaultsForLocale,
  type DataType,
  type FieldDefinition,
  type SeoDefaults,
  type SeoFieldKey,
  type SeoKeys,
} from '@shapio/schema';
import type { Policy } from '../permissions/types.js';
import type { HeadRow } from './compiler/compile.js';
import { maskAllows } from './compiler/policy.js';
import { fallbackChain } from './locales.js';
import type { ContentModel } from './model.js';
import type { ReadEnvironment } from './read.js';

/**
 * `?seo=resolved` (plan seo-fields): the SEO fields a delivered entry carries, with the site's defaults filled
 * in. The built-in component is found by stable ID; its fields by stable ID and the type they were created
 * with, so a renamed field still resolves and a removed or retyped one is passed through untouched.
 */
export type SeoReadOptions = {
  defaults: SeoDefaults;
  /** The default social image in the delivered shape, when it is a live public image of the site. */
  image: unknown;
};

const EXPECTED_TYPES: Readonly<Record<SeoFieldKey, ReadonlySet<DataType>>> = {
  title: new Set(['string', 'text']),
  description: new Set(['text', 'string']),
  image: new Set(['media']),
  canonical: new Set(['url', 'string']),
  noindex: new Set(['boolean']),
};

const keysOf = (model: ContentModel): SeoKeys => {
  const component = model.components.get(SEO_COMPONENT_ID)?.definition;
  const keys: SeoKeys = {};
  for (const [key, id] of Object.entries(SEO_FIELD_IDS) as Array<[SeoFieldKey, string]>) {
    const field = component?.fields.find((candidate) => candidate.id === id && !candidate.deprecated);
    const single = field?.type !== 'media' || !field.settings.multiple;
    if (field && single && EXPECTED_TYPES[key].has(field.type)) {
      keys[key] = field.apiKey;
    }
  }
  return keys;
};

/** The entry's own title, only when the caller may read the title field (never a hidden value). */
const fallbackTitleOf = (model: ContentModel, policy: Policy, row: HeadRow): string | null => {
  const field = effectiveTitleField(model.definition);
  if (!field || !maskAllows(policy.readMask, field)) {
    return null;
  }
  const value = row.data[field.id];
  return typeof value === 'string' ? value : null;
};

/** The locale whose defaults apply: the head's for localized models, the requested one otherwise. */
const defaultsLocaleOf = (env: ReadEnvironment, model: ContentModel, row: HeadRow): string =>
  model.definition.localized ? row.locale : (env.locale ?? env.snapshot.defaultLocale);

/** Whether the selected fields include an SEO field (only those are resolved). */
export const seoFieldsOf = (fields: readonly FieldDefinition[]): FieldDefinition[] =>
  fields.filter(isSeoField);

/** Replaces each SEO field's projected value with its resolved value. */
export const resolveSeoFields = (
  env: ReadEnvironment,
  options: SeoReadOptions,
  model: ContentModel,
  policy: Policy,
  fields: readonly FieldDefinition[],
  row: HeadRow,
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const seoFields = seoFieldsOf(fields);
  if (seoFields.length === 0) {
    return data;
  }
  const keys = keysOf(model);
  const context = {
    defaults: seoDefaultsForLocale(
      options.defaults,
      fallbackChain(env.snapshot, defaultsLocaleOf(env, model, row)),
    ),
    image: options.image,
    fallbackTitle: fallbackTitleOf(model, policy, row),
    keys,
  };
  const output = { ...data };
  for (const field of seoFields) {
    output[field.apiKey] = resolveSeo(data[field.apiKey], context);
  }
  return output;
};
