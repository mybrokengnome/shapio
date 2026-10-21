import DataLoader from 'dataloader';
import { relationTargetKey, type RelationTarget } from '../../../content/relationTarget.js';
import type { ContentServiceContext } from '../../../services/contentAccess.js';
import {
  loadDeliveryEntries,
  loadDeliveryLocalizations,
  type DeliveryEntry,
} from '../../../services/contentBatchReads.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { ReadScope } from './context.js';

/**
 * Per-request DataLoaders (ADR 0006): relation targets (per relation target: a model's family, an interface's
 * members, any entry) and `localizations` (per model) are batched per target and
 * read scope (site, locale, fallback, draft/published, snapshot), so a list of N entries costs one query per
 * relation field and level, never N. Media views are resolved inside each batch's projection.
 */
export type GraphqlLoaders = {
  entries: (
    snapshot: SchemaSnapshot,
    target: RelationTarget,
    scope: ReadScope,
  ) => DataLoader<string, DeliveryEntry | null>;
  localizations: (
    snapshot: SchemaSnapshot,
    modelId: string,
    scope: ReadScope,
  ) => DataLoader<string, DeliveryEntry[]>;
};

/** `subject` is a model ID (`localizations`) or a relation target's key (`relationTargetKey`). */
const keyOf = (kind: string, siteId: string, snapshot: SchemaSnapshot, subject: string, scope: ReadScope) =>
  JSON.stringify([
    kind,
    siteId,
    snapshot.version,
    subject,
    scope.locale ?? null,
    scope.fallback,
    scope.drafts,
    scope.snapshot ?? null,
  ]);

export const createLoaders = (
  siteId: () => string,
  content: (snapshot: SchemaSnapshot) => Promise<ContentServiceContext>,
): GraphqlLoaders => {
  const loaders = new Map<string, DataLoader<string, unknown>>();
  const memo = <V>(key: string, create: () => DataLoader<string, V>): DataLoader<string, V> => {
    let loader = loaders.get(key) as DataLoader<string, V> | undefined;
    if (!loader) {
      loader = create();
      loaders.set(key, loader);
    }
    return loader;
  };
  return {
    entries: (snapshot, target, scope) =>
      memo(
        keyOf('entries', siteId(), snapshot, relationTargetKey(target), scope),
        () =>
          new DataLoader<string, DeliveryEntry | null>(async (ids) => {
            const found = await loadDeliveryEntries(await content(snapshot), target, ids, scope);
            return ids.map((id) => found.get(id) ?? null);
          }),
      ),
    localizations: (snapshot, modelId, scope) =>
      memo(
        keyOf('localizations', siteId(), snapshot, modelId, scope),
        () =>
          new DataLoader<string, DeliveryEntry[]>(async (ids) => {
            const found = await loadDeliveryLocalizations(await content(snapshot), modelId, ids, scope);
            return ids.map((id) => found.get(id) ?? []);
          }),
      ),
  };
};
