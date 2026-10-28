import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** The site's change set settings (plan approval); the site is the request's (`Shapio-Site`). */
export const SITE_CHANGE_SETS_PATH = '/api/admin/site/change-sets';

/** Whether change sets need approval to ship, and the site version a save must name. */
export type SiteChangeSets = { version: number; requireApproval: boolean };

export type UpdateSiteChangeSetsInput = { expectedVersion: number; requireApproval: boolean };

/** Read by every admin of the site: the change set screen says why Ship is disabled. */
export const useSiteChangeSets = () =>
  useQuery({
    queryKey: queryKeys.siteChangeSets,
    queryFn: () => apiClient.request<SiteChangeSets>(SITE_CHANGE_SETS_PATH),
    meta: silent,
  });

/**
 * Saves the setting (`site.settings`); 409 when the site changed since `expectedVersion`. The site version is
 * shared with the SEO defaults, so their cached copy is read again.
 */
export const useUpdateSiteChangeSets = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['site', 'changeSets', 'update'],
    meta: silent,
    mutationFn: (input: UpdateSiteChangeSetsInput) =>
      withCsrf(() =>
        apiClient.request<SiteChangeSets>(SITE_CHANGE_SETS_PATH, { method: 'PUT', body: input }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.siteChangeSets, saved);
      return queryClient.invalidateQueries({ queryKey: queryKeys.siteSeo });
    },
  });
};
