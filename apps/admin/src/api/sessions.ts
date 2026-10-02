import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useSessions = () =>
  useQuery({ queryKey: queryKeys.sessions, queryFn: () => adminApi.sessions.list(), meta: { silent: true } });

export const useRevokeSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['sessions', 'revoke'],
    mutationFn: (id: string) => withCsrf(() => adminApi.sessions.revoke(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
};
