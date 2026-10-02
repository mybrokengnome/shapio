import type { SnapshotChangeKind } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '@/api/client';
import { isForbidden } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { useSnapshotChanges } from '@/api/snapshots';
import { useContentSchema } from '@/features/Content/hooks/useContentSchema';
import { RECENT_SHOWN, RECENT_SNAPSHOTS } from '../constants';
import { useEntryTitles } from './useEntryTitles';

export type RecentEntry = {
  id: string;
  title: string;
  modelKey: string;
  modelLabel: string;
  kind: 'collection' | 'singleton';
  change: Extract<SnapshotChangeKind, 'published' | 'updated'>;
};

/**
 * What went live in the last few snapshots: the snapshot diff from `current - RECENT_SNAPSHOTS` to the
 * current one (only models the admin may read), entries published or updated, titles from the list API.
 * Reading no model is not an error here: the server answers with an empty list (an older server's 403 is
 * read the same way), so the panel shows its empty state, never a permission lock.
 */
export const useRecentlyPublished = () => {
  const { schema } = useContentSchema();
  const current = useQuery({
    queryKey: queryKeys.currentSnapshot,
    queryFn: () => apiClient.snapshots.current(),
    meta: { silent: true },
  });
  const to = current.data?.snapshot ?? 0;
  const changes = useSnapshotChanges(Math.max(0, to - RECENT_SNAPSHOTS), to, to > 0);
  const live = useMemo(
    () =>
      (changes.data?.items ?? []).flatMap((item) => {
        const change = item.locales.find((locale) => locale.change !== 'unpublished')?.change;
        return change === 'published' || change === 'updated' ? [{ item, change }] : [];
      }),
    [changes.data],
  );
  const refs = useMemo(
    () => live.slice(0, RECENT_SHOWN).map(({ item }) => ({ modelKey: item.modelKey, entryId: item.id })),
    [live],
  );
  const titles = useEntryTitles(refs);
  const items = useMemo(
    () =>
      live.slice(0, RECENT_SHOWN).flatMap(({ item, change }): RecentEntry[] => {
        const model = schema?.models.get(item.modelId);
        const title = titles.get(item.id);
        return model && title !== undefined
          ? [
              {
                id: item.id,
                title,
                modelKey: model.apiKey,
                modelLabel: model.label,
                kind: model.kind,
                change,
              },
            ]
          : [];
      }),
    [live, schema, titles],
  );
  const error = current.error ?? changes.error;
  const forbidden = isForbidden(error);
  const nothingYet = (current.isSuccess && to === 0) || forbidden;
  return {
    items: forbidden ? [] : items,
    isPending: !nothingYet && (current.isPending || changes.isPending || schema === undefined),
    error: forbidden ? null : error,
  };
};
