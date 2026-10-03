import { safeLocalStorage } from '@/helpers/safeStorage';
import { routerBasePath } from './basePath';
import { splitSitePath, withSitePrefix } from './sitePaths';

/**
 * The site this page load works on (sites plan §H). It is fixed for the life of the document: switching
 * sites is a full navigation, so no query cache, store or in-flight request ever crosses sites.
 *
 * - `explicit`: the URL named the site (`/admin/s/blog/...`).
 * - Otherwise the last site this browser worked on; or none yet, in which case the API answers for the
 *   primary site and the site is taken from `me` (the primary site's key is never hardcoded).
 */
export type CurrentSite = { key: string | undefined; explicit: boolean };

const LAST_SITE_KEY = 'shapio.site';

/** The router path of the current URL (the part after `{BASE_PATH}/admin`). */
export const currentRouterPath = () => {
  const base = routerBasePath();
  const { pathname } = window.location;
  const rest = base !== '/' && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return rest.startsWith('/') ? rest : `/${rest}`;
};

const readLastSite = (): string | undefined => {
  const stored = safeLocalStorage.getItem(LAST_SITE_KEY);
  return typeof stored === 'string' && splitSitePath(`/s/${stored}`).key === stored ? stored : undefined;
};

const resolveBootSite = (): CurrentSite => {
  const { key } = splitSitePath(currentRouterPath());
  return key === undefined ? { key: readLastSite(), explicit: false } : { key, explicit: true };
};

let state: CurrentSite | undefined;

export const currentSite = (): CurrentSite => {
  state ??= resolveBootSite();
  return state;
};

/** Once `me` has said which site the API answered for (the primary site, when the URL named none). */
export const settleSiteKey = (key: string) => {
  state = { ...currentSite(), key };
};

/** Remembered for the next visit to a URL without a site. */
export const rememberSite = (key: string) => {
  void safeLocalStorage.setItem(LAST_SITE_KEY, key);
};

const forgetSite = () => {
  void safeLocalStorage.removeItem(LAST_SITE_KEY);
};

/** The public URL of a site's home (its Inbox). */
export const siteHomeUrl = (key: string) => `${routerBasePath().replace(/\/$/, '')}/s/${key}/`;

/** The public URL of a network page (`/network/sites`). */
export const networkUrl = (path = '/network') => `${routerBasePath().replace(/\/$/, '')}${path}`;

/**
 * Opens another site: a full navigation, so the new document starts with an empty query cache and sends
 * the new site's header from its first request.
 */
export const goToSite = (key: string) => {
  rememberSite(key);
  window.location.assign(siteHomeUrl(key));
};

/**
 * This page load's site was just deleted (from the network view): its requests would now fail, so forget it
 * and load the sites list again, which answers for the primary site.
 */
export const leaveDeletedSite = () => {
  forgetSite();
  window.location.assign(networkUrl('/network/sites'));
};

/**
 * The remembered site no longer exists (deleted, or another instance on the same origin): forget it and load
 * the page again without it, so the API answers for the primary site.
 */
export const leaveUnknownSite = () => {
  forgetSite();
  window.location.reload();
};

/** Replaces the current history entry's URL with the same page on the current site (`/content` → `/s/blog/content`). */
export const showSiteInAddressBar = () => {
  const base = routerBasePath().replace(/\/$/, '');
  const path = withSitePrefix(currentRouterPath(), currentSite().key);
  const { search, hash } = window.location;
  window.history.replaceState(window.history.state, '', `${base}${path}${search}${hash}`);
};
