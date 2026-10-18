import type {
  AltTextInput,
  ContentOpsInput,
  ContentOpsRun,
  RewriteInput,
  SchemaDraftInput,
  SummarizeInput,
  TranslateInput,
} from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIST_STATUS_STALE_MS, CONTENT_OPS_FINISHED, CONTENT_OPS_POLL_MS } from '@/constants/assist';
import { adminApi } from './client';
import { invalidateAllEntries } from './content';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

/** Assist errors are shown inline where the person asked (describeAssistError), so no toast. */
const silent = { silent: true } as const;

/** Whether assist is on, the provider and model, and (with `changes.manage`) this month's usage. */
export const useAssistStatus = () =>
  useQuery({
    queryKey: queryKeys.assist.status,
    queryFn: () => adminApi.assist.status(),
    staleTime: ASSIST_STATUS_STALE_MS,
    meta: silent,
  });

/** True only once the server said assist is on; every assist control renders nothing otherwise. */
export const useAssistEnabled = () => useAssistStatus().data?.enabled === true;

export const useSuggestAltText = () =>
  useMutation({
    mutationKey: ['assist', 'altText'],
    meta: silent,
    mutationFn: (input: AltTextInput) => withCsrf(() => adminApi.assist.altText(input)),
  });

export const useSummarizeField = () =>
  useMutation({
    mutationKey: ['assist', 'summarize'],
    meta: silent,
    mutationFn: (input: SummarizeInput) => withCsrf(() => adminApi.assist.summarize(input)),
  });

export const useTranslateEntry = () =>
  useMutation({
    mutationKey: ['assist', 'translate'],
    meta: silent,
    mutationFn: (input: TranslateInput) => withCsrf(() => adminApi.assist.translate(input)),
  });

export const useRewriteText = () =>
  useMutation({
    mutationKey: ['assist', 'rewrite'],
    meta: silent,
    mutationFn: (input: RewriteInput) => withCsrf(() => adminApi.assist.rewrite(input)),
  });

/** Proposed definitions for a description; writes nothing. */
export const useProposeSchema = () =>
  useMutation({
    mutationKey: ['assist', 'schemaDraft'],
    meta: silent,
    mutationFn: (input: SchemaDraftInput) => withCsrf(() => adminApi.assist.schemaDraft(input)),
  });

export const useProposeContentOps = () =>
  useMutation({
    mutationKey: ['assist', 'contentOps'],
    meta: silent,
    mutationFn: (input: ContentOpsInput) => withCsrf(() => adminApi.assist.proposeContentOps(input)),
  });

/** A content-ops run, re-read until it has finished. */
const isFinished = (run: Pick<ContentOpsRun, 'status'> | undefined) =>
  run !== undefined && CONTENT_OPS_FINISHED.includes(run.status);

/** Polled until it finishes. A run writes entry drafts (translations), so its finish refreshes the entries. */
export const useContentOpsRun = (runId: string | undefined) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.assist.run(runId ?? ''),
    queryFn: async () => {
      const before = queryClient.getQueryData<ContentOpsRun>(queryKeys.assist.run(runId ?? ''));
      const run = await adminApi.assist.contentOpsRun(runId ?? '');
      if (!isFinished(before) && isFinished(run)) {
        void invalidateAllEntries(queryClient);
      }
      return run;
    },
    enabled: runId !== undefined,
    meta: silent,
    refetchInterval: (query) => (isFinished(query.state.data) ? false : CONTENT_OPS_POLL_MS),
  });
};
