import type { ReviewEntryItem } from '@shapio/client';
import { useQueries } from '@tanstack/react-query';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';

/** Findings read per model: enough for a change set's entries (the endpoint has no entry filter). */
const FINDINGS_PER_MODEL = 200;

/** Open content-health findings on the set's entries, read per model and filtered to those entries. */
export const useSetHealthFindings = (entries: readonly ReviewEntryItem[]) => {
  const modelKeys = [...new Set(entries.flatMap((entry) => (entry.modelKey ? [entry.modelKey] : [])))];
  const entryIds = new Set(entries.map((entry) => entry.entryId));
  return useQueries({
    queries: modelKeys.map((modelKey) => {
      const query = { modelKey, limit: FINDINGS_PER_MODEL };
      return {
        queryKey: queryKeys.develop.setHealthFindings(query),
        queryFn: () => adminApi.contentHealth.list(query),
        meta: { silent: true },
      };
    }),
    combine: (results) => ({
      findings: results.flatMap((result) =>
        (result.data?.items ?? []).filter((finding) => entryIds.has(finding.entryId)),
      ),
      isPending: results.some((result) => result.isPending),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });
};
