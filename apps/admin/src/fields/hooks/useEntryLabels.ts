import type { ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useEntryList } from '@/api/content';
import { titleFieldOf } from '../helpers/titles';

const MAX_LOOKUP = 100;

/** Titles of related entries by ID, read in one list request (`filters[id][$in]`). */
export const useEntryLabels = (
  model: ModelDefinition | undefined,
  ids: readonly string[],
  locale: string | null,
) => {
  const title = model ? titleFieldOf(model) : undefined;
  const lookup = ids.slice(0, MAX_LOOKUP);
  const query = {
    filters: { id: { $in: [...lookup].sort() } },
    pageSize: Math.max(lookup.length, 1),
    ...(title ? { fields: [title.apiKey] } : {}),
    ...(locale && model?.localized ? { locale } : {}),
  };
  const list = useEntryList(model?.apiKey ?? '', query, model !== undefined && lookup.length > 0);
  const items = list.data?.items;
  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  return { byId, isLoading: list.isPending && lookup.length > 0, error: list.error };
};
