import { useInfiniteQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/**
 * Reads for the Inbox's "Awaiting your approval" group (plan approval). Kept apart from `api/changeSets` so the
 * Inbox loads none of the change set screens' code.
 */
const silent = { silent: true } as const;

/**
 * Sets in review that the caller can sign off now (the Inbox's "Awaiting your approval", plan
 * approval-workflows): the server keeps only those where the caller is eligible at the current stage.
 */
const AWAITING_APPROVAL = { status: 'open,failed', approval: 'requested', awaitingMe: true } as const;

/**
 * Sets awaiting the caller's approval, a short first page for the Inbox group, then full pages. A page can be
 * short (even empty) and still have a next cursor: the server filters by eligibility after paging. Only for
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
