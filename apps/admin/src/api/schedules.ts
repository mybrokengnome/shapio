import type { CreateScheduleInput, ScheduleQuery } from '@shapio/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const useSchedules = (query: ScheduleQuery) =>
  useQuery({
    queryKey: queryKeys.publishing.schedules.list(query),
    queryFn: () => adminApi.schedules.list(query),
    placeholderData: keepPreviousData,
    meta: silent,
  });

export const useCreateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['schedules', 'create'],
    meta: silent,
    mutationFn: (input: CreateScheduleInput) => withCsrf(() => adminApi.schedules.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.publishing.schedules.all }),
  });
};

export const useCancelSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['schedules', 'cancel'],
    mutationFn: (id: string) => withCsrf(() => adminApi.schedules.cancel(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.publishing.schedules.all }),
  });
};
