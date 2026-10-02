import type { JobQuery } from '@shapio/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const useJobs = (query: JobQuery) =>
  useQuery({
    queryKey: queryKeys.publishing.jobs.list(query),
    queryFn: () => adminApi.jobs.list(query),
    placeholderData: keepPreviousData,
    meta: silent,
  });

/** Counts per status (the Live page only shows the dead count). */
export const useJobSummary = () =>
  useQuery({
    queryKey: queryKeys.publishing.jobs.summary,
    queryFn: () => adminApi.jobs.summary(),
    meta: silent,
  });

/** Dead jobs only: the server answers 409 JOB_NOT_RETRYABLE otherwise. */
export const useRetryJob = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['jobs', 'retry'],
    mutationFn: (id: string) => withCsrf(() => adminApi.jobs.retry(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.publishing.jobs.all }),
  });
};
