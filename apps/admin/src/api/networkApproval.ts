import type { UpdateNetworkApprovalInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { isConflict } from './errors';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** The instance's default approval workflow and the sites that follow it (`sites.manage`). */
export const useNetworkApproval = () =>
  useQuery({
    queryKey: queryKeys.networkApproval,
    queryFn: () => adminApi.network.approval.get(),
    meta: silent,
  });

/**
 * Saves the default (`workflow: null` turns approval off by default); 409 when someone saved meanwhile, and
 * the fresh default is read again. Sites that inherit it change with it, so the site's settings are read again.
 */
export const useUpdateNetworkApproval = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['network', 'approval', 'update'],
    meta: silent,
    mutationFn: (input: UpdateNetworkApprovalInput) =>
      withCsrf(() => adminApi.network.approval.update(input)),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.networkApproval, saved);
      return queryClient.invalidateQueries({ queryKey: queryKeys.siteChangeSets });
    },
    onError: (error) =>
      isConflict(error) ? queryClient.invalidateQueries({ queryKey: queryKeys.networkApproval }) : undefined,
  });
};
