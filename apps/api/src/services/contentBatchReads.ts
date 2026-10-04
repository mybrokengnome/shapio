import type { HeadSource } from '../content/compiler/compile.js';
import { readScopeFor } from '../content/locales.js';
import { resolveModelById } from '../content/model.js';
import { fetchHeadsByIds, projectRows, readPolicy, systemAttributes } from '../content/read.js';
import type { ContentServiceContext } from './contentAccess.js';
import { deliveryEnvironment } from './contentDeliveryReads.js';

/**
 * Batched delivery reads by entry ID, for GraphQL's per-request DataLoaders (relation targets and
 * `localizations`). The projection is REST's `populate` projection: the target model's policy (row filter
 * and read mask), published heads only unless an admin asked for drafts, relation IDs limited to visible
 * targets, media as asset views, rich text with sanitized HTML.
 */
export type BatchReadOptions = {
  /** Requested locale; the default locale when absent. */
  locale: string | undefined;
  /** Serve a fallback locale when the requested one has no version (ADR 0004). */
  fallback: boolean;
  /** Draft heads instead of published ones (admin principals only; checked by the caller). */
  drafts: boolean;
  /** A publication sequence to read at (`snapshot`); ignored with `drafts`. */
  snapshot: number | undefined;
};

export type DeliveryEntry = Record<string, unknown>;

const sourceOf = (options: BatchReadOptions): HeadSource => {
  if (options.drafts) {
    return { kind: 'heads', state: 'draft' };
  }
  return options.snapshot !== undefined
    ? { kind: 'snapshot', seq: options.snapshot }
    : { kind: 'heads', state: 'published' };
};

/** Entries of one model by ID, keyed by entry ID. Entries the caller may not read are simply absent. */
export const loadDeliveryEntries = async (
  context: ContentServiceContext,
  modelId: string,
  ids: readonly string[],
  options: BatchReadOptions,
): Promise<Map<string, DeliveryEntry>> => {
  const found = new Map<string, DeliveryEntry>();
  const model = resolveModelById(context.snapshot, modelId);
  if (!model || ids.length === 0) {
    return found;
  }
  const env = deliveryEnvironment(context, context.db, sourceOf(options), options.locale);
  const policy = await readPolicy(env, modelId);
  const scope = readScopeFor(context.snapshot, model.definition, options.locale, {
    fallback: options.fallback,
  });
  const rows = await fetchHeadsByIds(env, model, policy, ids, scope);
  const projected = await projectRows(env, model, policy, rows, { fields: null, populate: new Map() });
  for (const { row, data } of projected) {
    found.set(row.entry_id, { ...systemAttributes(env, row), ...data });
  }
  return found;
};

/**
 * Every locale version of the given entries the caller may read, keyed by entry ID, in the instance's
 * locale order. Each version is projected in its own locale (its relations resolve in that locale).
 */
export const loadDeliveryLocalizations = async (
  context: ContentServiceContext,
  modelId: string,
  entryIds: readonly string[],
  options: Pick<BatchReadOptions, 'drafts' | 'snapshot'>,
): Promise<Map<string, DeliveryEntry[]>> => {
  const found = new Map<string, DeliveryEntry[]>(entryIds.map((id) => [id, []]));
  const model = resolveModelById(context.snapshot, modelId);
  if (!model || !model.definition.localized || entryIds.length === 0) {
    return found;
  }
  const source = sourceOf({ ...options, locale: undefined, fallback: false });
  const env = deliveryEnvironment(context, context.db, source, undefined);
  const policy = await readPolicy(env, modelId);
  const rows = await fetchHeadsByIds(env, model, policy, entryIds, { kind: 'any' });
  for (const { code } of context.snapshot.locales) {
    const inLocale = rows.filter((row) => row.locale === code);
    if (inLocale.length === 0) {
      continue;
    }
    const localeEnv = { ...env, locale: code };
    const projected = await projectRows(localeEnv, model, policy, inLocale, {
      fields: null,
      populate: new Map(),
    });
    for (const { row, data } of projected) {
      found.get(row.entry_id)?.push({ ...systemAttributes(localeEnv, row), ...data });
    }
  }
  return found;
};
