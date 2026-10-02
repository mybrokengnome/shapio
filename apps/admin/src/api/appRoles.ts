import type { CreateAppRoleInput, UpdateAppRoleInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useAppRoles = () =>
  useQuery({
    queryKey: queryKeys.appRoles.all,
    queryFn: () => adminApi.appRoles.list(),
    meta: { silent: true },
  });

export const useAppRole = (id: string) =>
  useQuery({
    queryKey: queryKeys.appRoles.role(id),
    queryFn: () => adminApi.appRoles.get(id),
    meta: { silent: true },
  });

export const useCreateAppRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appRoles', 'create'],
    meta: { silent: true },
    mutationFn: (input: CreateAppRoleInput) => withCsrf(() => adminApi.appRoles.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.appRoles.all }),
  });
};

export const useUpdateAppRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appRoles', 'update'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: UpdateAppRoleInput }) =>
      withCsrf(() => adminApi.appRoles.update(id, input)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.appRoles.all }),
  });
};

export const useDeleteAppRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['appRoles', 'delete'],
    mutationFn: (id: string) => withCsrf(() => adminApi.appRoles.remove(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.appRoles.all }),
  });
};

/** App role names by ID, for the roles app users hold. */
export const useAppRoleNames = () => {
  const roles = useAppRoles();
  const names = useMemo(() => new Map((roles.data ?? []).map((role) => [role.id, role.name])), [roles.data]);
  return { names, error: roles.error };
};
