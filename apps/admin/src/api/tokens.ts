import type { CreateApiTokenInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useApiTokens = () =>
  useQuery({ queryKey: queryKeys.tokens, queryFn: () => adminApi.tokens.list(), meta: { silent: true } });

export const useCreateApiToken = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['tokens', 'create'],
    meta: { silent: true },
    mutationFn: (input: CreateApiTokenInput) => withCsrf(() => adminApi.tokens.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tokens }),
  });
};

export const useRevokeApiToken = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['tokens', 'revoke'],
    mutationFn: (id: string) => withCsrf(() => adminApi.tokens.revoke(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tokens }),
  });
};
