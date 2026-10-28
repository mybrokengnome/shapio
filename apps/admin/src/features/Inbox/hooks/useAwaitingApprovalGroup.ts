import { useState } from 'react';
import { useHasGlobalPermission } from '@/api/auth';
import { useAwaitingApproval } from '@/api/changeSetApprovals';
import { FINDINGS_PAGE_SIZE, GROUP_PREVIEW } from '../constants';

/**
 * "Awaiting your approval" (plan approval): change sets someone asked to approve, for admins who may approve
 * them. Read live from the change set list (nothing is stored); the first GROUP_PREVIEW, then every loaded
 * one after "Show all", with further pages a "Load more" away.
 */
export const useAwaitingApprovalGroup = () => {
  const canApprove = useHasGlobalPermission('changes.approve');
  const canManage = useHasGlobalPermission('changes.manage');
  const enabled = canApprove && canManage;
  const query = useAwaitingApproval({ previewSize: GROUP_PREVIEW, pageSize: FINDINGS_PAGE_SIZE }, enabled);
  const [expanded, setExpanded] = useState(false);
  const loaded = enabled ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [];
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
