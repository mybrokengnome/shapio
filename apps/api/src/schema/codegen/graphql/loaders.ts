import DataLoader from 'dataloader';
import type { ContentServiceContext } from '../../../services/contentAccess.js';
import {
  loadDeliveryEntries,
  loadDeliveryLocalizations,
  type DeliveryEntry,
} from '../../../services/contentBatchReads.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { ReadScope } from './context.js';

/**
 * Per-request DataLoaders (ADR 0006): relation targets and `localizations` are batched per target model and
 * read scope (site, locale, fallback, draft/published, snapshot), so a list of N entries costs one query per
 * relation field and level, never N. Media views are resolved inside each batch's projection.
 */
export type GraphqlLoaders = {
  entries: (
    snapshot: SchemaSnapshot,
    modelId: string,
    scope: ReadScope,
  ) => DataLoader<string, DeliveryEntry | null>;
  localizations: (
    snapshot: SchemaSnapshot,
    modelId: string,
    scope: ReadScope,
  ) => DataLoader<string, DeliveryEntry[]>;
};

const keyOf = (kind: string, siteId: string, snapshot: SchemaSnapshot, modelId: string, scope: ReadScope) =>
  JSON.stringify([
    kind,
    siteId,
    snapshot.version,
    modelId,
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
    entries: (snapshot, modelId, scope) =>
      memo(
        keyOf('entries', siteId(), snapshot, modelId, scope),
        () =>
          new DataLoader<string, DeliveryEntry | null>(async (ids) => {
            const found = await loadDeliveryEntries(await content(snapshot), modelId, ids, scope);
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
