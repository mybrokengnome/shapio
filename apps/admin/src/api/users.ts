import type { AdminUserStatus, InviteUserInput, UpdateAdminUserInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

export const useUsers = () =>
  useQuery({ queryKey: queryKeys.users, queryFn: () => adminApi.users.list(), meta: { silent: true } });

export const useInvitations = () =>
  useQuery({
    queryKey: queryKeys.invitations,
    queryFn: () => adminApi.invitations.list(),
    meta: { silent: true },
  });

export const useInviteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['invitations', 'create'],
    meta: { silent: true },
    mutationFn: (input: InviteUserInput) => withCsrf(() => adminApi.invitations.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
  });
};

export const useRevokeInvitation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['invitations', 'revoke'],
    mutationFn: (id: string) => withCsrf(() => adminApi.invitations.revoke(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
  });
};

/** A fresh accept link to send by hand; any earlier link for the invitation stops working. */
export const useIssueInvitationLink = () =>
  useMutation({
    mutationKey: ['invitations', 'link'],
    mutationFn: (id: string) => withCsrf(() => adminApi.invitations.link(id)),
  });

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['users', 'update'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: UpdateAdminUserInput }) =>
      withCsrf(() => adminApi.users.update(id, input)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
};

export const useSetUserStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['users', 'setStatus'],
    mutationFn: ({ id, status }: { id: string; status: AdminUserStatus }) =>
      withCsrf(() => adminApi.users.update(id, { status })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
};

export const useRemoveUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['users', 'remove'],
    mutationFn: (id: string) => withCsrf(() => adminApi.users.remove(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
};
