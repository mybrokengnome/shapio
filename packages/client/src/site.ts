import { SITE_HEADER } from './admin/sites.js';
import { DELIVERY_PATH } from './delivery.js';
import { DELIVERY_SITE_PATH } from './siteDelivery.js';
import { SNAPSHOT_PATHS } from './snapshots.js';

/** Delivery reads name their site with `?site=`; everything else with the `Shapio-Site` header. */
export const SITE_QUERY_PARAMETER = 'site';

/** Delivery reads (content, snapshots, the site): a GET there carries the site in its URL. */
const DELIVERY_READ_PREFIXES = [
  `${DELIVERY_PATH}/`,
  `${DELIVERY_PATH}?`,
  '/api/snapshots/',
  `${DELIVERY_SITE_PATH}?`,
] as const;

const isDeliveryRead = (method: string, path: string) =>
  method === 'GET' &&
  (path === DELIVERY_PATH ||
    path === DELIVERY_SITE_PATH ||
    Object.values(SNAPSHOT_PATHS).some((snapshotPath) => path === snapshotPath) ||
    DELIVERY_READ_PREFIXES.some((prefix) => path.startsWith(prefix)));

const namesSite = (path: string) => {
  const index = path.indexOf('?');
  return index !== -1 && new URLSearchParams(path.slice(index + 1)).has(SITE_QUERY_PARAMETER);
};

/**
 * Where a request names the client's site (sites plan §H). Delivery GETs put it in the query string: a
 * simple cross-origin GET needs no CORS preflight, and URL-keyed CDN caches keep sites apart. Every other
 * request sends the `Shapio-Site` header. A path that already names a site is left as it is.
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
