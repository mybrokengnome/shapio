import { SITE_HEADER } from './admin/sites.js';
import { DELIVERY_PATH } from './delivery.js';
import { DELIVERY_SITE_PATH, DELIVERY_WORKSPACE_PATH } from './siteDelivery.js';
import { SNAPSHOT_PATHS } from './snapshots.js';

/**
 * Delivery reads name their workspace with `?site=`; everything else with the `Shapio-Site` header. Every
 * server version reads this spelling, so the client sends it.
 */
export const SITE_QUERY_PARAMETER = 'site';

/**
 * The newer spelling of `SITE_QUERY_PARAMETER`, for callers who build raw requests (server 0.8.2 or later;
 * `?site=` works on every version). The client itself still sends `?site=`.
 */
export const WORKSPACE_QUERY_PARAMETER = 'workspace';

/** Both spellings a path may already name its workspace with. */
const WORKSPACE_QUERY_PARAMETERS = [WORKSPACE_QUERY_PARAMETER, SITE_QUERY_PARAMETER] as const;

/** Delivery reads (content, snapshots, the workspace): a GET there carries the workspace in its URL. */
const DELIVERY_READ_PREFIXES = [
  `${DELIVERY_PATH}/`,
  `${DELIVERY_PATH}?`,
  '/api/snapshots/',
  `${DELIVERY_SITE_PATH}?`,
  `${DELIVERY_WORKSPACE_PATH}?`,
] as const;

const isDeliveryRead = (method: string, path: string) =>
  method === 'GET' &&
  (path === DELIVERY_PATH ||
    path === DELIVERY_SITE_PATH ||
    path === DELIVERY_WORKSPACE_PATH ||
    Object.values(SNAPSHOT_PATHS).some((snapshotPath) => path === snapshotPath) ||
    DELIVERY_READ_PREFIXES.some((prefix) => path.startsWith(prefix)));

const namesSite = (path: string) => {
  const index = path.indexOf('?');
  if (index === -1) {
    return false;
  }
  const query = new URLSearchParams(path.slice(index + 1));
  return WORKSPACE_QUERY_PARAMETERS.some((parameter) => query.has(parameter));
};

/**
 * Where a request names the client's workspace (sites plan §H). Delivery GETs put it in the query string: a
 * simple cross-origin GET needs no CORS preflight, and URL-keyed CDN caches keep workspaces apart. Every other
 * request sends the `Shapio-Site` header. A path that already names a workspace (`?site=` or `?workspace=`)
 * is left as it is.
 */
export const applySite = (
  site: string | undefined,
  method: string,
  path: string,
): { path: string; headers: Record<string, string> } => {
  if (site === undefined || namesSite(path)) {
    return { path, headers: {} };
  }
  if (isDeliveryRead(method, path)) {
    const parameter = `${SITE_QUERY_PARAMETER}=${encodeURIComponent(site)}`;
    return { path: `${path}${path.includes('?') ? '&' : '?'}${parameter}`, headers: {} };
  }
  return { path, headers: { [SITE_HEADER]: site } };
};

/** The two spellings of the workspace option (`site` is the older one). */
export type WorkspaceOption = { workspace?: string | undefined; site?: string | undefined };

/**
 * The workspace key a client names, from its `workspace` option or the older `site` one. Both set to
 * different keys is a mistake the caller must fix, so it throws (`toError` picks the error class).
 */
export const resolveWorkspaceOption = (
  { workspace, site }: WorkspaceOption,
  caller: string,
  toError: (message: string) => Error = (message) => new Error(message),
): string | undefined => {
  if (workspace !== undefined && site !== undefined && workspace !== site) {
    throw toError(
      `${caller}: the workspace option ('${workspace}') and the site option ('${site}') name different ` +
        'workspaces. Pass only workspace (site is its older name).',
    );
  }
  return workspace ?? site;
};
