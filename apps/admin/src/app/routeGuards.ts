import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions, setupStatusQueryOptions } from '@/api/auth';
import { logError } from '@/helpers/reportError';

/** First run: no owner exists yet. If the status can't be read, assume setup is done (sign-in still works). */
const isSetupRequired = async (queryClient: QueryClient) => {
  try {
    return (await queryClient.ensureQueryData(setupStatusQueryOptions)).required;
  } catch (error) {
    logError(error, 'reading setup status');
    return false;
  }
};

/** Signed-in screens: send visitors to setup (first run) or sign-in, remembering where they were going. */
export const requireSession = async (queryClient: QueryClient, currentHref: string) => {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (me) {
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
