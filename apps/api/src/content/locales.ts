import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../constants/itemIds.js';
import type { ContentData } from '../db/contentData.js';
import type { SchemaById } from '../schema/snapshot.js';
import type { LocaleScope } from './compiler/compile.js';
import { queryInvalid } from './compiler/types.js';
import type { ComponentLookup } from './itemIds.js';
import { isLocalizedField } from './model.js';
import { sameContent } from './sameContent.js';
import { valueWithoutItemIds } from './withoutItemIds.js';

/**
 * Localization rules (ADR 0004). Every locale's head holds the complete document; shared (non-localized)
 * fields are fanned out to every existing draft of the entry when saved; publishing is strictly per locale.
 */

/** The locale itself, then its configured fallbacks, then the default locale (always last). */
export const fallbackChain = (snapshot: SchemaById, locale: string): string[] => {
  const configured = snapshot.locales.find((candidate) => candidate.code === locale);
  const chain = [locale, ...(configured?.fallbacks ?? []), snapshot.defaultLocale];
  return chain.filter(
    (code, index) => chain.indexOf(code) === index && snapshot.locales.some((l) => l.code === code),
  );
};

/** The locale a write targets: the requested one for localized models, the default locale otherwise. */
export const writeLocaleFor = (
  snapshot: SchemaById,
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
  snapshot: SchemaById,
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

/** Fields (of those given) whose values differ between two documents. */
export const changedFieldIds = (
  fields: ReadonlyArray<{ id: string }>,
  before: Readonly<ContentData>,
  after: Readonly<ContentData>,
): Set<string> =>
  new Set(fields.filter((field) => !sameContent(before[field.id], after[field.id])).map((field) => field.id));

/** Shared fields whose values differ between two documents. */
export const changedSharedFieldIds = (
  model: ModelDefinition,
  before: Readonly<ContentData>,
  after: Readonly<ContentData>,
): Set<string> => changedFieldIds(sharedFields(model), before, after);

/** Every item ID stored in a value, at any depth, sorted (a multiset). */
const storedItemIdsOf = (value: unknown): string[] => {
  const ids: string[] = [];
  const stack: unknown[] = [value];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (Array.isArray(current)) {
      stack.push(...(current as unknown[]));
    } else if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>;
      if (typeof record[ITEM_ID_KEY] === 'string') {
        ids.push(record[ITEM_ID_KEY]);
      }
      stack.push(...Object.values(record));
    }
  }
  return ids.sort();
};

/**
 * Whether a locale's shared values would change only in which of its identical items carries which ID (identical
 * items reordered in another locale): the same content and the same IDs, so the locale is not rewritten for it.
 * Every locale keeps the same items and IDs; only the order of look-alikes may differ between them.
 */
export const sharedValuesOnlyRenumbered = (
  model: ModelDefinition,
  current: Readonly<ContentData>,
  next: Readonly<ContentData>,
  fieldIds: ReadonlySet<string>,
  componentOf: ComponentLookup,
): boolean =>
  sharedFields(model)
    .filter((field) => fieldIds.has(field.id))
    .every(
      (field) =>
        sameContent(
          valueWithoutItemIds(field, current[field.id], componentOf),
          valueWithoutItemIds(field, next[field.id], componentOf),
        ) && sameContent(storedItemIdsOf(current[field.id]), storedItemIdsOf(next[field.id])),
    );

export type LocaleHeads = {
  locale: string;
  draft?: Readonly<ContentData>;
  published?: Readonly<ContentData>;
};

/** Whether a shared field's content differs, item IDs (plan item-ids) left out: they are not content. */
const sharedContentChanged = (
  model: ModelDefinition,
  before: Readonly<ContentData>,
  after: Readonly<ContentData>,
  componentOf: ComponentLookup,
) =>
  sharedFields(model).some(
    (field) =>
      !sameContent(
        valueWithoutItemIds(field, before[field.id], componentOf),
        valueWithoutItemIds(field, after[field.id], componentOf),
      ),
  );

/**
 * Published locales whose live shared values are older than their draft's (which always holds the latest
 * shared values). The admin offers to publish these too after a shared field changed (ADR 0004). An item that
 * only gained its persisted ID in the draft does not make a locale outdated (`componentOf`: the model's
 * components, so nested instances are compared without their IDs too).
 */
export const outdatedSharedLocales = (
  model: ModelDefinition,
  heads: readonly LocaleHeads[],
  componentOf: ComponentLookup = () => undefined,
): string[] =>
  model.localized
    ? heads
        .filter(
          ({ draft, published }) =>
            draft && published && sharedContentChanged(model, published, draft, componentOf),
        )
        .map(({ locale }) => locale)
    : [];
