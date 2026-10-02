import type { AdminEntryPage } from '@shapio/client';
import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import { useQueries } from '@tanstack/react-query';
import { linkOptions } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { entryListQueryOptions } from '@/api/content';
import { useDefinitions } from '@/api/schema';
import { isSearchable, labelOf, titleFieldOf } from '@/fields/helpers/titles';
import { canOnModel } from '@/helpers/modelPermissions';
import { ENTRY_RESULTS_PER_MODEL, MIN_SEARCH_LENGTH } from '../constants';
import type { PaletteItem } from '../types';

const entryLink = (model: ModelDefinition, entryId: string) =>
  model.kind === 'singleton'
    ? linkOptions({ to: '/content/$modelKey', params: { modelKey: model.apiKey } })
    : linkOptions({ to: '/content/$modelKey/$entryId', params: { modelKey: model.apiKey, entryId } });

/**
 * Entries whose title matches `query`: the list API's `q` per readable place with a text title, the top few
 * of each, in place order. `query` should already be debounced.
 */
export const useEntrySearch = (query: string): { items: PaletteItem[]; isFetching: boolean } => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: definitions } = useDefinitions('model');
  const q = query.trim();
  const enabled = q.length >= MIN_SEARCH_LENGTH;
  const models = useMemo(
    () =>
      (definitions ?? [])
        .map(({ definition }) => definition)
        .filter(isModelDefinition)
        .filter((model) => isSearchable(model) && canOnModel(me, model.id, 'read'))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [definitions, me],
  );
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
              ? page.items.map((item): PaletteItem => ({
                  id: `entry:${model.id}:${item.id}`,
                  label: labelOf(model, item, t('palette.untitled')),
                  hint: model.label,
                  icon: FileText,
                  link: entryLink(model, item.id),
                }))
              : [];
          })
        : [],
    }),
  });
};
