import type { HealthRule } from '@shapio/client';
import { useState } from 'react';
import { useRuleFindings } from '@/api/contentHealth';
import { FINDINGS_PAGE_SIZE, GROUP_PREVIEW } from '../constants';

/**
 * One "Needs you" group's findings: the first GROUP_PREVIEW, then, after "Show all", every loaded one with
 * the rule's further pages a "Load more" away.
 */
export const useRuleGroupFindings = (rule: HealthRule) => {
  const query = useRuleFindings(rule, { previewSize: GROUP_PREVIEW, pageSize: FINDINGS_PAGE_SIZE });
  const [expanded, setExpanded] = useState(false);
  const loaded = query.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    query,
    findings: expanded ? loaded : loaded.slice(0, GROUP_PREVIEW),
    expanded,
    /** More findings than the preview are loaded or on the server. */
    canShowAll: !expanded && (loaded.length > GROUP_PREVIEW || query.hasNextPage),
    showAll: () => {
      setExpanded(true);
      if (loaded.length <= GROUP_PREVIEW && query.hasNextPage) {
        void query.fetchNextPage();
      }
    },
    /** The rule has another page after "Show all". */
    hasMore: expanded && query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
};
