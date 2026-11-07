import type { MeResponse, NetworkAction } from '@shapio/client';

/** Whether the admin holds a role on the site `me` answered for (none: the no-role state). */
export const hasSiteRole = (me: Pick<MeResponse, 'site' | 'sites'>) =>
  me.sites.some((site) => site.id === me.site.id);

/** Any of these opens the network view (workspaces, admin users, roles, the audit log, the shared schema). */
const NETWORK_VIEW_ACTIONS: readonly NetworkAction[] = [
  'sites.manage',
  'users.manage',
  'roles.manage',
  'audit.read',
  'schema.create',
];

export const canSeeNetwork = (me: Pick<MeResponse, 'networkPermissions'> | null | undefined) =>
  me?.networkPermissions.some((action) => NETWORK_VIEW_ACTIONS.includes(action)) ?? false;

/**
 * A delivery path naming the workspace (`?workspace=`; the server also takes the original `?site=`), for
 * requests made the way a site would make them (the API explorer, copyable snippets). The primary workspace
 * needs none: requests that name no workspace go there.
 */
export const withSiteParameter = (path: string, siteKey: string | undefined) =>
  siteKey === undefined
    ? path
    : `${path}${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(siteKey)}`;
