import type { AppUserQuery, UpdateAppUserInput } from '@shapio/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useAppUsers = (query: AppUserQuery) =>
  useQuery({
    queryKey: queryKeys.appUsers.list(query),
    queryFn: () => adminApi.appUsers.list(query),
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });

export const useUpdateAppUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appUsers', 'update'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: UpdateAppUserInput }) =>
      withCsrf(() => adminApi.appUsers.update(id, input)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.appUsers.all }),
  });
};

/** Block or unblock from a menu: failures toast (not silent), since there is no form to show them. */
export const useSetAppUserBlocked = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appUsers', 'setBlocked'],
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      withCsrf(() => adminApi.appUsers.update(id, { blocked })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.appUsers.all }),
  });
};

export const useRemoveAppUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appUsers', 'remove'],
    mutationFn: (id: string) => withCsrf(() => adminApi.appUsers.remove(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.appUsers.all }),
  });
};

export const useResendAppUserConfirmation = () =>
  useMutation({
    mutationKey: ['appUsers', 'resendConfirmation'],
    mutationFn: (id: string) => withCsrf(() => adminApi.appUsers.resendConfirmation(id)),
  });
