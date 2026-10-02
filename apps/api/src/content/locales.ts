import { isDeepStrictEqual } from 'node:util';
import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import type { ContentData } from '../db/contentData.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { LocaleScope } from './compiler/compile.js';
import { queryInvalid } from './compiler/types.js';
import { isLocalizedField } from './model.js';

/**
 * Localization rules (ADR 0004). Every locale's head holds the complete document; shared (non-localized)
 * fields are fanned out to every existing draft of the entry when saved; publishing is strictly per locale.
 */

/** The locale itself, then its configured fallbacks, then the default locale (always last). */
export const fallbackChain = (snapshot: SchemaSnapshot, locale: string): string[] => {
  const configured = snapshot.locales.find((candidate) => candidate.code === locale);
  const chain = [locale, ...(configured?.fallbacks ?? []), snapshot.defaultLocale];
  return chain.filter(
    (code, index) => chain.indexOf(code) === index && snapshot.locales.some((l) => l.code === code),
  );
};

/** The locale a write targets: the requested one for localized models, the default locale otherwise. */
export const writeLocaleFor = (
  snapshot: SchemaSnapshot,
  model: ModelDefinition,
  requested: string | undefined,
) => {
  if (!model.localized) {
    return snapshot.defaultLocale;
  }
  const locale = requested ?? snapshot.defaultLocale;
  if (!snapshot.locales.some((candidate) => candidate.code === locale)) {
    throw queryInvalid(`Unknown locale "${locale}"`);
  }
  return locale;
};

/**
 * Which heads serve a read. Non-localized models keep their heads in whichever locale they were created in,
 * so they are read regardless of locale; localized models serve the requested locale or fall back.
 */
export const readScopeFor = (
  snapshot: SchemaSnapshot,
  model: ModelDefinition,
  requested: string | undefined,
  { fallback }: { fallback: boolean },
): LocaleScope => {
  if (!model.localized) {
    return { kind: 'any' };
  }
  const locale = requested ?? snapshot.defaultLocale;
  return { kind: 'chain', chain: fallback ? fallbackChain(snapshot, locale) : [locale] };
};

export const sharedFields = (model: ModelDefinition): FieldDefinition[] =>
  model.fields.filter((field) => !isLocalizedField(model, field));

/** Copies the shared fields' values (present or absent) from `source` into `target`. */
export const withSharedValuesOf = (
  model: ModelDefinition,
  target: Readonly<ContentData>,
  source: Readonly<ContentData>,
  fieldIds?: ReadonlySet<string>,
): ContentData => {
  const output: ContentData = { ...target };
  for (const field of sharedFields(model)) {
    if (fieldIds && !fieldIds.has(field.id)) {
      continue;
    }
    if (source[field.id] === undefined) {
      delete output[field.id];
    } else {
      output[field.id] = source[field.id];
    }
  }
  return output;
};

/** Shared fields whose values differ between two documents. */
export const changedSharedFieldIds = (
  model: ModelDefinition,
  before: Readonly<ContentData>,
  after: Readonly<ContentData>,
): Set<string> =>
  new Set(
    sharedFields(model)
      .filter((field) => !isDeepStrictEqual(before[field.id], after[field.id]))
      .map((field) => field.id),
  );

export type LocaleHeads = {
  locale: string;
  draft?: Readonly<ContentData>;
  published?: Readonly<ContentData>;
};

/**
 * Published locales whose live shared values are older than their draft's (which always holds the latest
 * shared values). The admin offers to publish these too after a shared field changed (ADR 0004).
 */
export const outdatedSharedLocales = (model: ModelDefinition, heads: readonly LocaleHeads[]): string[] =>
  model.localized
    ? heads
        .filter(
          ({ draft, published }) =>
            draft && published && changedSharedFieldIds(model, published, draft).size > 0,
        )
        .map(({ locale }) => locale)
    : [];
