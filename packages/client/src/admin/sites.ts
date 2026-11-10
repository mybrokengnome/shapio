import type { RequestFn } from '../request.js';
import type {
  CreateSiteInput,
  SetSiteAppRolesInput,
  Site,
  SiteAppRoles,
  UpdateSiteInput,
} from './sitesTypes.js';

export const SITES_PATHS = { sites: '/api/admin/sites' } as const;

/**
 * The header that names the workspace a workspace-scoped request is about (default: the primary workspace).
 * Every server version reads it, so the client sends it.
 */
export const SITE_HEADER = 'shapio-site';

/**
 * The newer spelling of `SITE_HEADER`, for callers who build raw requests (server 0.8.2 or later;
 * `Shapio-Site` works on every version). The client itself still sends `Shapio-Site`.
 */
export const WORKSPACE_HEADER = 'shapio-workspace';

const sitePath = (id: string) => `${SITES_PATHS.sites}/${encodeURIComponent(id)}`;

/**
 * Workspaces (network routes): listing shows the workspaces the caller holds a role on; changes need
 * `sites.manage`.
 */
const createWorkspacesGroup = (request: RequestFn) => ({
  list: () => request<Site[]>(SITES_PATHS.sites),
  get: (id: string) => request<Site>(sitePath(id)),
  create: (body: CreateSiteInput) => request<Site>(SITES_PATHS.sites, { method: 'POST', body }),
  update: (id: string, body: UpdateSiteInput) => request<Site>(sitePath(id), { method: 'PATCH', body }),
  /**
   * Only an empty workspace (409 `SITE_NOT_EMPTY`), and not while it is the primary workspace
   * (409 `SITE_IS_PRIMARY`: make another workspace primary first).
   */
  remove: (id: string) => request<void>(sitePath(id), { method: 'DELETE' }),
  /**
   * Makes the workspace primary (`sites.manage`): requests that name no workspace, and credentials that belong
   * to no workspace, read it from the next request on. Already primary: returned unchanged.
   */
  makePrimary: (id: string) => request<Site>(`${sitePath(id)}/make-primary`, { method: 'POST' }),
  /**
   * The app roles bound to the workspace's anonymous callers (`public`) and signed-in app users
   * (`authenticated`).
   */
  appRoles: {
    get: (id: string) => request<SiteAppRoles>(`${sitePath(id)}/app-roles`),
    /** Replaces both bindings (`roles.manage`). */
    set: (id: string, body: SetSiteAppRolesInput) =>
      request<SiteAppRoles>(`${sitePath(id)}/app-roles`, { method: 'PUT', body }),
  },
});

/** `admin.workspaces` and its older name `admin.sites`: the same calls on the same paths. */
export const createSitesApi = (request: RequestFn) => {
  const workspaces = createWorkspacesGroup(request);
  return {
    workspaces,
    /** The older name of `workspaces`. */
    sites: workspaces,
  };
};
