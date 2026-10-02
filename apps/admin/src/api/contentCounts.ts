import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/** The server caches counts for 60s; asking more often would only return the same numbers. */
const COUNTS_STALE_MS = 60_000;

/** Entries per model (readable models only), keyed by model ID; undefined while loading or on failure. */
export const useContentCounts = () => {
  const query = useQuery({
    queryKey: queryKeys.contentCounts,
    queryFn: () => adminApi.contentCounts.list(),
    staleTime: COUNTS_STALE_MS,
    meta: { silent: true },
  });
  return useMemo(
    () =>
      query.data
        ? new Map(query.data.counts.map((count) => [count.modelId, count.total] as const))
        : undefined,
    [query.data],
  );
};
