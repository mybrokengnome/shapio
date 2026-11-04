import type { ContentOpsInput } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useContentOpsRun, useProposeContentOps } from '@/api/assist';
import { queryKeys } from '@/api/queryKeys';

export type AltDecision = 'accepted' | 'rejected';

/**
 * A content-ops run asked for from the Inbox ("Propose fixes" on a rule group) or a content type's list
 * ("Fill in…"): starts it with `base` (plus what the person picked, for a fill), follows it until it
 * finishes, and keeps the person's accept/reject decisions on its alt-text proposals (for this visit).
 */
export const useContentOpsProposal = (base: ContentOpsInput) => {
  const queryClient = useQueryClient();
  const start = useProposeContentOps();
  const [runId, setRunId] = useState<string>();
  const run = useContentOpsRun(runId);
  const [decisions, setDecisions] = useState<Readonly<Record<string, AltDecision>>>({});
  const status = run.data?.status;
  return {
    propose: (picked?: Partial<ContentOpsInput>) => {
      setDecisions({});
      start.mutate({ ...base, ...picked }, { onSuccess: ({ runId: id }) => setRunId(id) });
    },
    runId,
    running:
      start.isPending ||
      (runId !== undefined && (status === undefined || status === 'queued' || status === 'running')),
    run: run.data,
    error: start.error ?? run.error,
    decisions,
    decide: (assetId: string, decision: AltDecision) =>
      setDecisions((current) => ({ ...current, [assetId]: decision })),
    /**
     * After the review: accepted images' findings resolve, so the Inbox re-reads them (not during the
     * review, which would unmount the group, and this list, once the last finding goes).
     */
    finishReview: () => {
      if (Object.values(decisions).includes('accepted')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.contentHealth.all });
      }
    },
  };
};
