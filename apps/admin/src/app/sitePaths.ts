/**
 * Where the site sits in an admin URL (sites plan §H, ADR 0011). Paths here are the router's: relative to
 * the router basepath (`{BASE_PATH}/admin`). Site pages carry the site as a prefix (`/s/blog/content/posts`);
 * network pages (`/network/*`) and the signed-out screens (sign-in, setup, password reset, invitations: the
 * links in emails) carry none.
 */

const SITE_PREFIX = /^\/s\/([a-z][a-z0-9-]{0,62})(?=\/|$)/;

export const NETWORK_PATH = '/network';

/** Screens outside any site: signed out, or reached from an email link. */
const UNSITED_PATHS: readonly string[] = [
  '/setup',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation',
];

const isUnder = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** The site key a path names, and the path without it (`/s/blog/content` → `blog`, `/content`). */
export const splitSitePath = (pathname: string): { key: string | undefined; rest: string } => {
  const match = SITE_PREFIX.exec(pathname);
  if (!match) {
    return { key: undefined, rest: pathname };
  }
  return { key: match[1], rest: pathname.slice(match[0].length) || '/' };
};

/** Network pages and signed-out screens: their URLs never carry a site. */
export const isSitelessPath = (pathname: string) =>
  isUnder(pathname, NETWORK_PATH) || UNSITED_PATHS.some((path) => isUnder(pathname, path));

export const isNetworkPath = (pathname: string) => isUnder(pathname, NETWORK_PATH);

/** The public path of a router path on a site: `/content` → `/s/blog/content`; siteless paths unchanged. */
export const withSitePrefix = (pathname: string, key: string | undefined) =>
  key === undefined || isSitelessPath(pathname) ? pathname : `/s/${key}${pathname === '/' ? '/' : pathname}`;

/**
 * A site page whose URL doesn't carry the site yet (`/admin/content/posts`, or `/admin/` itself): the
 * router rewrites it to the site's URL once the site is known.
 */
export const needsSitePrefix = (pathname: string) =>
  splitSitePath(pathname).key === undefined && !isSitelessPath(pathname);
