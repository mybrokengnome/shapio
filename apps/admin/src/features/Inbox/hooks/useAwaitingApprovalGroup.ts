import { useEffect, useState } from 'react';
import { useHasGlobalPermission } from '@/api/auth';
import { useAwaitingApproval } from '@/api/changeSetApprovals';
import { FINDINGS_PAGE_SIZE, GROUP_PREVIEW } from '../constants';

/**
 * "Awaiting your approval" (plan approval-workflows): change sets in review that this admin can sign off now.
 * Read live from the change set list (nothing is stored); the first GROUP_PREVIEW, then every loaded one after
 * "Show all", with further pages a "Load more" away. The server filters by eligibility after paging, so a page
 * can come back short with more after it: the preview reads on until it is full or the list ends.
 */
export const useAwaitingApprovalGroup = () => {
  const canApprove = useHasGlobalPermission('changes.approve');
  const canManage = useHasGlobalPermission('changes.manage');
  const enabled = canApprove && canManage;
  const query = useAwaitingApproval({ previewSize: GROUP_PREVIEW, pageSize: FINDINGS_PAGE_SIZE }, enabled);
  const [expanded, setExpanded] = useState(false);
  const loaded = enabled ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  const short = enabled && loaded.length < GROUP_PREVIEW;
  useEffect(() => {
    if (short && hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [short, hasNextPage, isFetching, isError, fetchNextPage]);
  return {
    enabled,
    query,
    sets: expanded ? loaded : loaded.slice(0, GROUP_PREVIEW),
    /** Sets loaded so far (the list has no total; "Show all" reads on). */
    count: loaded.length,
    hasMorePages: query.hasNextPage,
    canShowAll: !expanded && (loaded.length > GROUP_PREVIEW || query.hasNextPage),
    showAll: () => {
      setExpanded(true);
      if (loaded.length <= GROUP_PREVIEW && query.hasNextPage) {
        void query.fetchNextPage();
      }
    },
    hasMore: expanded && query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
};

export type AwaitingApprovalGroup = ReturnType<typeof useAwaitingApprovalGroup>;
