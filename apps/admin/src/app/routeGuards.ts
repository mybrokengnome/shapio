import type { MeResponse } from '@shapio/client';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions, setupStatusQueryOptions } from '@/api/auth';
import { logError } from '@/helpers/reportError';
import { hasSiteRole } from '@/helpers/sites';
import {
  currentRouterPath,
  currentSite,
  goToSite,
  rememberSite,
  settleSiteKey,
  showSiteInAddressBar,
} from './currentSite';
import { needsSitePrefix } from './sitePaths';

/** First run: no owner exists yet. If the status can't be read, assume setup is done (sign-in still works). */
const isSetupRequired = async (queryClient: QueryClient) => {
  try {
    return (await queryClient.ensureQueryData(setupStatusQueryOptions)).required;
  } catch (error) {
    logError(error, 'reading setup status');
    return false;
  }
};

/**
 * The page's site, once `me` says which site the API answered for (sites plan §H):
 * - a URL without a site lands on a site the admin works on (the remembered or primary one, else their
 *   first site: a full navigation, so nothing cached for the other site survives);
 * - a site the admin works on is remembered for the next visit without a site;
 * - a site page reached without the site in its URL gets it in the address bar (the same entry, replaced:
 *   the router's own location is site-free and unchanged, so this is not a navigation).
 * A URL that names a site is never redirected: without a role there, the Shell says so.
 */
const settleSite = (me: MeResponse): Promise<never> | undefined => {
  settleSiteKey(me.site.key);
  const hasRole = hasSiteRole(me);
  const elsewhere = me.sites[0];
  if (!hasRole && !currentSite().explicit && elsewhere) {
    goToSite(elsewhere.key);
    return new Promise<never>(() => undefined);
  }
  if (hasRole) {
    rememberSite(me.site.key);
  }
  if (needsSitePrefix(currentRouterPath())) {
    showSiteInAddressBar();
  }
  return undefined;
};

/** Signed-in screens: send visitors to setup (first run) or sign-in, remembering where they were going. */
export const requireSession = async (queryClient: QueryClient, currentHref: string) => {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (me) {
    await settleSite(me);
    return me;
  }
  if (await isSetupRequired(queryClient)) {
    throw redirect({ to: '/setup' });
  }
  throw redirect({ to: '/login', search: { redirect: currentHref === '/' ? undefined : currentHref } });
};

/** Signed-out screens: someone already signed in goes straight to the app. */
export const redirectIfSignedIn = async (queryClient: QueryClient, destination: string) => {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (me) {
    throw redirect({ href: destination });
  }
};

export const requireSetupPending = async (queryClient: QueryClient) => {
  if (!(await isSetupRequired(queryClient))) {
    throw redirect({ to: '/login' });
  }
};

export const redirectToSetupIfPending = async (queryClient: QueryClient) => {
  if (await isSetupRequired(queryClient)) {
    throw redirect({ to: '/setup' });
  }
};
