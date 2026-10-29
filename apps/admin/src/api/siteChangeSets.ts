import type { UpdateSiteChangeSetsInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { isConflict } from './errors';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/**
 * The site's approval mode and workflow (plan approval-workflows); the site is the request's (`Shapio-Site`).
 * Read by every admin of the site: the change set screen needs `effective` to know whether sets need approval.
 */
export const useSiteChangeSets = () =>
  useQuery({
    queryKey: queryKeys.siteChangeSets,
    queryFn: () => adminApi.site.changeSets.get(),
    meta: silent,
  });

/**
 * Saves the mode and workflow (`site.settings`); 409 when the site changed since `expectedVersion`, and the
 * fresh settings are read again. The site version is shared with the SEO defaults, and the network default's
 * list of sites that follow it changes too, so both cached copies are read again.
 */
export const useUpdateSiteChangeSets = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['site', 'changeSets', 'update'],
    meta: silent,
    mutationFn: (input: UpdateSiteChangeSetsInput) => withCsrf(() => adminApi.site.changeSets.update(input)),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.siteChangeSets, saved);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.siteSeo }),
        queryClient.invalidateQueries({ queryKey: queryKeys.networkApproval }),
      ]);
    },
    onError: (error) =>
      isConflict(error) ? queryClient.invalidateQueries({ queryKey: queryKeys.siteChangeSets }) : undefined,
  });
};
