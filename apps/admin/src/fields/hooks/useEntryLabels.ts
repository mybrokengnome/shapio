import { useMemo } from 'react';
import { useContentTargets, useEntryList } from '@/api/content';
import { readsContentTargets, type RelationTargetInfo } from '../helpers/relationTargetLabel';
import { entryTitle, titleFieldOf } from '../helpers/titles';

const MAX_LOOKUP = 100;

/** A linked entry as a relation shows it: its title (undefined: untitled) and its own model's API ID. */
export type LinkedEntryLabel = { title: string | undefined; model: string };

const sortedLookup = (ids: readonly string[]) => [...ids.slice(0, MAX_LOOKUP)].sort();

/**
 * Titles and models of a relation's linked entries by ID, in one request: a model target's list
 * (`filters[id][$in]`), or for an interface or any entry the content-targets lookup by `ids`, which finds
 * each entry whatever its type (plan interfaces D11).
 */
export const useEntryLabels = (
  target: RelationTargetInfo,
  fieldId: string,
  ids: readonly string[],
  locale: string | null,
) => {
  const lookup = sortedLookup(ids);
  const model = target.kind === 'model' ? target.model : undefined;
  const title = model ? titleFieldOf(model) : undefined;
  const list = useEntryList(
    model?.apiKey ?? '',
    {
      filters: { id: { $in: lookup } },
      pageSize: Math.max(lookup.length, 1),
      ...(title ? { fields: [title.apiKey] } : {}),
      ...(locale && model?.localized ? { locale } : {}),
    },
    model !== undefined && lookup.length > 0,
  );
  const crossType = readsContentTargets(target);
  const targets = useContentTargets(
    { field: fieldId, ids: lookup, ...(locale ? { locale } : {}) },
    crossType && lookup.length > 0,
  );
  const listItems = list.data?.items;
  const targetItems = targets.data?.items;
  const byId = useMemo(() => {
    const labels = new Map<string, LinkedEntryLabel>();
    if (model) {
      for (const item of listItems ?? []) {
        labels.set(item.id, { title: entryTitle(model, item.data), model: item.model });
      }
    } else if (crossType) {
      for (const item of targetItems ?? []) {
        labels.set(item.id, { title: item.title?.trim() || undefined, model: item.model });
      }
    }
    return labels;
  }, [model, crossType, listItems, targetItems]);
  const query = model ? list : targets;
  return {
    byId,
    /** The target's types by API ID, as the server named them (interface and any-entry targets). */
    members: targets.data?.members,
    isLoading: query.isPending && lookup.length > 0 && (model !== undefined || crossType),
    error: query.error,
  };
};
