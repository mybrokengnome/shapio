import { useMemo } from 'react';
import { useContentTargets, useEntryList } from '@/api/content';
import { readsContentTargets, type RelationTargetInfo } from '../helpers/relationTargetLabel';
import { entryTitle, isSearchable } from '../helpers/titles';
import type { LinkedEntryLabel } from './useEntryLabels';

/** An entry a relation may link, as a picker lists it. */
export type RelationOption = LinkedEntryLabel & { id: string };

type RelationOptionsQuery = {
  target: RelationTargetInfo;
  /** The relation field's stable ID (the content-targets endpoint resolves the target from it). */
  fieldId: string;
  /** The search text (already debounced and trimmed). */
  q: string;
  /** Interface and any-entry targets: only these types (singular API IDs); empty for every one. */
  types: readonly string[];
  locale: string | null;
  pageSize: number;
  enabled?: boolean;
};

/**
 * The entries a relation picker offers: a model target's own list (its kinds' entries included), or, for an
 * interface or any entry, the content-targets endpoint over every member type the person may read, with the
 * members for the type filter (plan interfaces D6, D11).
 */
export const useRelationOptions = ({
  target,
  fieldId,
  q,
  types,
  locale,
  pageSize,
  enabled = true,
}: RelationOptionsQuery) => {
  const model = target.kind === 'model' ? target.model : undefined;
  const crossType = readsContentTargets(target);
  // The server searches each member's own title and skips members without a searchable one.
  const searchable = model ? isSearchable(model) : crossType;
  const list = useEntryList(
    model?.apiKey ?? '',
    {
      pageSize,
      ...(q && searchable ? { q } : {}),
      ...(locale && model?.localized ? { locale } : {}),
    },
    enabled && model !== undefined,
  );
  const targets = useContentTargets(
    {
      field: fieldId,
      pageSize,
      ...(q ? { q } : {}),
      ...(types.length > 0 ? { types: [...types].sort() } : {}),
      ...(locale ? { locale } : {}),
    },
    enabled && crossType,
  );
  const listItems = list.data?.items;
  const targetItems = targets.data?.items;
  const items = useMemo((): RelationOption[] => {
    if (model) {
      return (listItems ?? []).map((item) => ({
        id: item.id,
        model: item.model,
        title: entryTitle(model, item.data),
      }));
    }
    return (targetItems ?? []).map((item) => ({
      id: item.id,
      model: item.model,
      title: item.title?.trim() || undefined,
    }));
  }, [model, listItems, targetItems]);
  const query = model ? list : targets;
  return {
    items,
    /** Interface and any-entry targets: the types the person may read, for the type filter. */
    members: targets.data?.members ?? [],
    searchable,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
