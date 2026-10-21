import type { HeadSource } from '../content/compiler/compile.js';
import { groupByMember } from '../content/family.js';
import { resolveModelById } from '../content/model.js';
import {
  fetchHeadsByIds,
  fetchTargetHeadsByIds,
  projectRows,
  readPolicy,
  systemAttributes,
} from '../content/read.js';
import type { RelationTarget } from '../content/relationTarget.js';
import type { ContentServiceContext } from './contentAccess.js';
import { deliveryEnvironment } from './contentDeliveryReads.js';

/**
 * Batched delivery reads by entry ID, for GraphQL's per-request DataLoaders (relation targets and
 * `localizations`). The projection is REST's `populate` projection: the target model's policy (row filter
 * and read mask), published heads only unless an admin asked for drafts, relation IDs limited to visible
 * targets, media as asset views, rich text with sanitized HTML. A relation target is read over every model it
 * accepts (a family, plan polymorphic-types D7; an interface's members or any entry, plan interfaces D4): each
 * entry is projected as its own model, under that model's policy.
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

/**
 * Entries a relation's target accepts by ID (plan interfaces D4), keyed by entry ID, each projected as its own
 * model under that model's policy: a model and its kinds, an interface's members, or any entry (the models the
 * IDs belong to are looked up first, so only those are read). Entries the caller may not read (a model it may
 * not read included) are simply absent. One head query per batch, whatever the number of models.
 */
export const loadDeliveryEntries = async (
  context: ContentServiceContext,
  target: RelationTarget,
  ids: readonly string[],
  options: BatchReadOptions,
): Promise<Map<string, DeliveryEntry>> => {
  const found = new Map<string, DeliveryEntry>();
  if (ids.length === 0) {
    return found;
  }
  const env = deliveryEnvironment(context, context.db, sourceOf(options), options.locale);
  const heads = await fetchTargetHeadsByIds(env, target, ids, { fallback: options.fallback });
  // Sequential on purpose: one pool connection per batch, however many models appear.
  for (const { member, rows } of groupByMember(heads.members, heads.rows)) {
    const projected = await projectRows(env, member.model, member.policy, rows, {
      fields: null,
      populate: new Map(),
    });
    for (const { row, data } of projected) {
      found.set(row.entry_id, { ...systemAttributes(env, row), ...data });
    }
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
