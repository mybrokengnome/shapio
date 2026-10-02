import type { AdminEntryPage } from '@shapio/client';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { entryListQueryOptions } from '@/api/content';
import { findModelByKey, useContentSchema } from '@/features/Content/hooks/useContentSchema';
import { labelOf, titleFieldOf } from '@/fields/helpers/titles';

type EntryRef = { modelKey: string; entryId: string };

/**
 * Titles of a few entries known only by ID (scheduled publications): one list request per model with an
 * `id` filter, never an entry read (the document owns that cache).
 */
export const useEntryTitles = (refs: readonly EntryRef[]): ReadonlyMap<string, string> => {
  const { t } = useTranslation();
  const { schema } = useContentSchema();
  const byModel = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const { modelKey, entryId } of refs) {
      ids.set(modelKey, [...new Set([...(ids.get(modelKey) ?? []), entryId])]);
    }
    return [...ids].flatMap(([modelKey, entryIds]) => {
      const model = schema ? findModelByKey(schema, modelKey) : undefined;
      return model ? [{ model, entryIds }] : [];
    });
  }, [refs, schema]);
  const combine = useCallback(
    (results: UseQueryResult<AdminEntryPage>[]): ReadonlyMap<string, string> =>
      new Map(
        results.flatMap((result, index) => {
          const model = byModel[index]?.model;
          return model && result.data
            ? result.data.items.map((item) => [item.id, labelOf(model, item, t('content.untitled'))] as const)
            : [];
        }),
      ),
    [byModel, t],
  );
  return useQueries({
    queries: byModel.map(({ model, entryIds }) => {
      const title = titleFieldOf(model);
      return entryListQueryOptions(model.apiKey, {
        filters: { id: { $in: entryIds } },
        pageSize: entryIds.length,
        ...(title ? { fields: [title.apiKey] } : {}),
      });
    }),
    combine,
  });
};
