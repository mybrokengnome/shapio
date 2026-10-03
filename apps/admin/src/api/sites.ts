import type { CreateSiteInput, SetSiteAppRolesInput, Site, UpdateSiteInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { currentSite, leaveDeletedSite } from '@/app/currentSite';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

/** The sites list and `me` (whose `sites` feed the switcher) after a site is created, renamed or deleted. */
const refreshSites = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sites.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  ]);

/** Every site the admin works on (all of them with a role on every site). */
export const useSites = () =>
  useQuery({ queryKey: queryKeys.sites.all, queryFn: () => adminApi.sites.list(), meta: { silent: true } });

export const useSite = (id: string) =>
  useQuery({
    queryKey: queryKeys.sites.site(id),
    queryFn: () => adminApi.sites.get(id),
    meta: { silent: true },
  });

/** Site names by ID, for the role assignments and webhooks that name a site. */
export const useSiteNames = () => {
  const sites = useSites();
  const names = useMemo(() => new Map((sites.data ?? []).map((site) => [site.id, site.name])), [sites.data]);
  return { names, error: sites.error };
};

export const useCreateSite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['sites', 'create'],
    meta: { silent: true },
    mutationFn: (input: CreateSiteInput) => withCsrf(() => adminApi.sites.create(input)),
    onSuccess: () => refreshSites(queryClient),
  });
};

export const useUpdateSite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['sites', 'update'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: UpdateSiteInput }) =>
      withCsrf(() => adminApi.sites.update(id, input)),
    onSettled: () => refreshSites(queryClient),
  });
};

/**
 * Shows its own error (`SITE_NOT_EMPTY`, `SITE_IS_PRIMARY`) where the delete was asked for. Deleting the site
 * this page load works on leaves it (a full navigation to the sites list): every request names that site.
 */
export const useDeleteSite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['sites', 'delete'],
    meta: { silent: true },
    mutationFn: (site: Pick<Site, 'id' | 'key'>) => withCsrf(() => adminApi.sites.remove(site.id)),
    onSuccess: (_result, site) => {
      if (site.key === currentSite().key) {
        leaveDeletedSite();
        return undefined;
      }
      queryClient.removeQueries({ queryKey: queryKeys.sites.site(site.id) });
      return refreshSites(queryClient);
    },
  });
};

export const useSiteAppRoles = (id: string) =>
  useQuery({
    queryKey: queryKeys.sites.appRoles(id),
    queryFn: () => adminApi.sites.appRoles.get(id),
    meta: { silent: true },
  });

export const useSetSiteAppRoles = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['sites', 'appRoles', 'set'],
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: SetSiteAppRolesInput }) =>
      withCsrf(() => adminApi.sites.appRoles.set(id, input)),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.sites.appRoles(result.siteId), result),
  });
};
