import type { ContentHealthQuery } from '@shapio/client';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** Findings are refreshed by the server in the background; a short stale time keeps the Inbox current. */
const HEALTH_STALE_MS = 30_000;

/** Open findings the admin may read, a page at a time (the Inbox's "Needs you"). */
export const useContentHealthFindings = (query: Omit<ContentHealthQuery, 'cursor'>, enabled = true) =>
  useInfiniteQuery({
    queryKey: queryKeys.contentHealth.list(query),
    queryFn: ({ pageParam }) =>
      adminApi.contentHealth.list({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: HEALTH_STALE_MS,
    enabled,
    meta: silent,
  });

/** Open findings per rule (the Inbox's counts; the developer pages' health card can share it). */
export const useContentHealthSummary = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.contentHealth.summary,
    queryFn: () => adminApi.contentHealth.summary(),
    staleTime: HEALTH_STALE_MS,
    enabled,
    meta: silent,
  });
