import type { AdminEntryPage } from '@shapio/client';
import type { ModelDefinition, ResolvedModelDefinition } from '@shapio/schema';
import { useQueries } from '@tanstack/react-query';
import { linkOptions } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { entryListQueryOptions } from '@/api/content';
import { isSearchable, labelOf, titleFieldOf } from '@/fields/helpers/titles';
import { canOnModel } from '@/helpers/modelPermissions';
import { useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';
import { ENTRY_RESULTS_PER_MODEL, MIN_SEARCH_LENGTH } from '../constants';
import type { PaletteItem } from '../types';

const entryLink = (model: ModelDefinition, entryId: string) =>
  model.kind === 'singleton'
    ? linkOptions({ to: '/content/$modelKey', params: { modelKey: model.apiKey } })
    : linkOptions({ to: '/content/$modelKey/$entryId', params: { modelKey: model.apiKey, entryId } });

/**
 * Entries whose title matches `query`: the list API's `q` per readable place with a text title, the top few
 * of each, in place order. `query` should already be debounced. Only roots are searched: a type's list
 * already holds its kinds' entries, and each result opens under its own kind.
 */
export const useEntrySearch = (query: string): { items: PaletteItem[]; isFetching: boolean } => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { resolved } = useResolvedDefinitions();
  const q = query.trim();
  const enabled = q.length >= MIN_SEARCH_LENGTH;
  const { models, byKey } = useMemo(() => {
    const all = [...(resolved?.byId.values() ?? [])];
    const searched = (model: ResolvedModelDefinition) =>
      isSearchable(model) && canOnModel(me, model.id, 'read');
    return {
      models: all
        .filter(
          (model) =>
            searched(model) &&
            !model.ancestorIds.some((id) => {
              const ancestor = resolved?.byId.get(id);
              return ancestor !== undefined && searched(ancestor);
            }),
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
      byKey: new Map(all.map((model) => [model.apiKey, model])),
    };
  }, [resolved, me]);
  return useQueries({
    queries: models.map((model) => {
      const title = titleFieldOf(model);
      return {
        ...entryListQueryOptions(model.apiKey, {
          q,
          pageSize: ENTRY_RESULTS_PER_MODEL,
          ...(title ? { fields: [title.apiKey] } : {}),
        }),
        placeholderData: undefined,
        enabled,
      };
    }),
    combine: (results) => ({
      isFetching: enabled && results.some((result) => result.isFetching),
      items: enabled
        ? results.flatMap((result, index) => {
            const model = models[index];
            const page: AdminEntryPage | undefined = result.data;
            return model && page
              ? page.items.map((item): PaletteItem => {
                  // A kind's entry, found through its family's root, opens under its own kind.
                  const own = byKey.get(item.model) ?? model;
                  return {
                    id: `entry:${own.id}:${item.id}`,
                    label: labelOf(model, item, t('palette.untitled')),
                    hint: own.label,
                    icon: FileText,
                    link: entryLink(own, item.id),
                  };
                })
              : [];
          })
        : [],
    }),
  });
};
