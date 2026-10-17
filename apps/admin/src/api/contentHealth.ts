import type { HealthRule } from '@shapio/client';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** Findings are refreshed by the server in the background; a short stale time keeps the Inbox current. */
const HEALTH_STALE_MS = 30_000;

/** Where a rule's next page of findings starts, and how many it holds. */
type FindingsPageParam = { cursor: string | undefined; limit: number };

const firstFindingsPage = (limit: number): FindingsPageParam => ({ cursor: undefined, limit });

/**
 * One rule's open findings the admin may read (an Inbox "Needs you" group): a short first page for the
 * group's preview, then full pages from where it stopped.
 */
export const useRuleFindings = (
  rule: HealthRule,
  { previewSize, pageSize }: { previewSize: number; pageSize: number },
) =>
  useInfiniteQuery({
    queryKey: queryKeys.contentHealth.list({ rule, limit: previewSize }),
    queryFn: ({ pageParam }) =>
      adminApi.contentHealth.list({
        rule,
        limit: pageParam.limit,
        ...(pageParam.cursor ? { cursor: pageParam.cursor } : {}),
      }),
    initialPageParam: firstFindingsPage(previewSize),
    getNextPageParam: (page): FindingsPageParam | undefined =>
      page.nextCursor ? { cursor: page.nextCursor, limit: pageSize } : undefined,
    staleTime: HEALTH_STALE_MS,
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
