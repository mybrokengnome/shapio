import { useInfiniteQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/**
 * Reads for the Inbox's "Awaiting your approval" group (plan approval). Kept apart from `api/changeSets` so the
 * Inbox loads none of the change set screens' code.
 */
const silent = { silent: true } as const;

/** Sets that can still be approved and are waiting for it (the Inbox's "Awaiting your approval"). */
const AWAITING_APPROVAL = { status: 'open,failed', approval: 'requested' } as const;

/**
 * Sets awaiting approval, a short first page for the Inbox group, then full pages (plan approval). Only for
 * admins who may approve (`enabled`).
 */
export const useAwaitingApproval = (
  { previewSize, pageSize }: { previewSize: number; pageSize: number },
  enabled: boolean,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.develop.changeSets.awaitingApproval(previewSize),
    queryFn: ({ pageParam }) =>
      adminApi.changeSets.list({
        ...AWAITING_APPROVAL,
        limit: pageParam.limit,
        ...(pageParam.cursor ? { cursor: pageParam.cursor } : {}),
      }),
    initialPageParam: { cursor: undefined as string | undefined, limit: previewSize },
    getNextPageParam: (page) => (page.nextCursor ? { cursor: page.nextCursor, limit: pageSize } : undefined),
    enabled,
    meta: silent,
  });
