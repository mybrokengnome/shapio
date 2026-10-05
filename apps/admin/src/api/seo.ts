import { EMPTY_SEO_DEFAULTS, type SeoDefaults } from '@shapio/schema';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { withCsrf } from './csrf';
import { hasErrorCode } from './errors';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** Admin routes of the SEO feature (plan seo-fields); the site is the request's (`Shapio-Site`). */
export const SEO_PATHS = {
  ensure: '/api/admin/components/builtin/seo/ensure',
  siteSeo: '/api/admin/site/seo',
} as const;

/** `POST …/builtin/seo/ensure`: the shared SEO component, created when it didn't exist yet. */
export type EnsuredSeoComponent = { definitionId: string; version: number; created: boolean };

/** The site's SEO defaults and the site version a save must name (`expectedVersion`). */
export type SiteSeo = { version: number; seo: SeoDefaults };

export type UpdateSiteSeoInput = { expectedVersion: number; seo: SeoDefaults };

/** The unrelated definition that already uses the `seo` API ID (409 `SEO_COMPONENT_CONFLICT`). */
export type SeoComponentConflict = { id: string; apiKey: string; label: string; scope: string };

export const SEO_COMPONENT_CONFLICT = 'SEO_COMPONENT_CONFLICT';

/** The definition a `SEO_COMPONENT_CONFLICT` names, or undefined for any other error. */
export const seoConflictOf = (error: unknown): SeoComponentConflict | undefined => {
  if (!hasErrorCode(error, SEO_COMPONENT_CONFLICT)) {
    return undefined;
  }
  const details = (error as { details?: { definition?: SeoComponentConflict } }).details;
  return details?.definition;
};

/**
 * Creates the shared SEO component if it is missing (network `schema.create`); the schema changed, so
 * everything schema-derived is read again. Errors are the caller's to show (the conflict names a definition).
 */
export const useEnsureSeoComponent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['seo', 'ensure'],
    meta: silent,
    mutationFn: () =>
      withCsrf(() => apiClient.request<EnsuredSeoComponent>(SEO_PATHS.ensure, { method: 'POST' })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schema.all }),
  });
};

export const siteSeoQueryOptions = queryOptions({
  queryKey: queryKeys.siteSeo,
  queryFn: () => apiClient.request<SiteSeo>(SEO_PATHS.siteSeo),
  meta: silent,
});

/** The current site's SEO defaults (`site.settings`). */
export const useSiteSeo = () => useQuery(siteSeoQueryOptions);

/**
 * The site's SEO defaults for previews (the SEO field's search result). Someone who can't read them (no
 * `site.settings`) gets none: the preview then shows the entry's own values only.
 */
export const useSiteSeoDefaults = (): SeoDefaults => {
  const { data } = useQuery({ ...siteSeoQueryOptions, select: (siteSeo) => siteSeo.seo });
  return data ?? EMPTY_SEO_DEFAULTS;
};

/** Saves the site's SEO defaults; 409 when someone else saved since `expectedVersion`. */
export const useUpdateSiteSeo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['seo', 'update'],
    meta: silent,
    mutationFn: (input: UpdateSiteSeoInput) =>
      withCsrf(() => apiClient.request<SiteSeo>(SEO_PATHS.siteSeo, { method: 'PUT', body: input })),
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.siteSeo, saved),
  });
};
