import type { CreateRoleInput, UpdateRoleInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useRoles = () =>
  useQuery({ queryKey: queryKeys.roles, queryFn: () => adminApi.roles.list(), meta: { silent: true } });

export const useCreateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['roles', 'create'],
    meta: { silent: true },
    mutationFn: (input: CreateRoleInput) => withCsrf(() => adminApi.roles.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles }),
  });
};

export const useUpdateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['roles', 'update'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: UpdateRoleInput }) =>
      withCsrf(() => adminApi.roles.update(id, input)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles }),
  });
};

export const useDeleteRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['roles', 'delete'],
    mutationFn: (id: string) => withCsrf(() => adminApi.roles.remove(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles }),
  });
};

/** Role names by ID, for showing the roles that users, invitations and tokens reference. */
export const useRoleNames = () => {
  const roles = useRoles();
  const names = useMemo(() => new Map((roles.data ?? []).map((role) => [role.id, role.name])), [roles.data]);
  return { names, error: roles.error };
};
