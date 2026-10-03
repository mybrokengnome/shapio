import type { RequestFn } from '../request.js';
import type {
  CreateSiteInput,
  SetSiteAppRolesInput,
  Site,
  SiteAppRoles,
  UpdateSiteInput,
} from './sitesTypes.js';

export const SITES_PATHS = { sites: '/api/admin/sites' } as const;

/** The admin API header that names the site a site-scoped request is about (default: the primary site). */
export const SITE_HEADER = 'shapio-site';

const sitePath = (id: string) => `${SITES_PATHS.sites}/${encodeURIComponent(id)}`;

/** Sites (network routes): listing shows the sites the caller holds a role on; changes need `sites.manage`. */
export const createSitesApi = (request: RequestFn) => ({
  sites: {
    list: () => request<Site[]>(SITES_PATHS.sites),
    get: (id: string) => request<Site>(sitePath(id)),
    create: (body: CreateSiteInput) => request<Site>(SITES_PATHS.sites, { method: 'POST', body }),
    update: (id: string, body: UpdateSiteInput) => request<Site>(sitePath(id), { method: 'PATCH', body }),
    /** Only an empty site (409 `SITE_NOT_EMPTY`); never the primary site (409 `SITE_IS_PRIMARY`). */
    remove: (id: string) => request<void>(sitePath(id), { method: 'DELETE' }),
    /** The app roles bound to the site's anonymous callers (`public`) and signed-in app users (`authenticated`). */
    appRoles: {
      get: (id: string) => request<SiteAppRoles>(`${sitePath(id)}/app-roles`),
      /** Replaces both bindings (`roles.manage`). */
      set: (id: string, body: SetSiteAppRolesInput) =>
        request<SiteAppRoles>(`${sitePath(id)}/app-roles`, { method: 'PUT', body }),
    },
  },
});
