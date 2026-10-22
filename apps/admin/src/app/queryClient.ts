import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { hasErrorCode, isBlockedRequest, isForbidden, isNotFound, isUnauthorized } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { logError, reportError } from '@/helpers/reportError';
import { hasUnsavedEdits, useSessionStore } from '@/stores/session';

declare module '@tanstack/react-query' {
  interface Register {
    /**
     * `silent`: logged but no toast, because the caller shows the error itself (inline form error, state view).
     * `silentNotFound`: the same for 404 only, where callers show a "no longer exists" state.
     */
    queryMeta: { silent?: boolean; silentNotFound?: boolean };
    mutationMeta: { silent?: boolean };
  }
}

const MAX_RETRIES = 2;

const AUTH_KEYS: ReadonlySet<string> = new Set(['auth', 'setup']);

/**
 * The admin lost its role on this site mid-session (`SITE_FORBIDDEN`; `SITE_MISMATCH` for a credential of
 * another site), or the site is gone (`SITE_NOT_FOUND`). The Shell shows a page-level state from `me` for
 * these, so they are logged, not toasted one request at a time.
 */
const SITE_ACCESS_CODES = ['SITE_FORBIDDEN', 'SITE_MISMATCH', 'SITE_NOT_FOUND'] as const;

export const isSiteAccessError = (error: unknown) =>
  SITE_ACCESS_CODES.some((code) => hasErrorCode(error, code));

/** 4xx answers are final; only network and 5xx failures are worth retrying. */
const shouldRetry = (failureCount: number, error: unknown) =>
  failureCount < MAX_RETRIES &&
  !isUnauthorized(error) &&
  !isForbidden(error) &&
  !isBlockedRequest(error) &&
  !isNotFound(error);

export const createQueryClient = () => {
  /**
   * Any 401 means the session ended (expired, revoked elsewhere, signed out in another tab). Over unsaved
   * edits the page stays and asks for the password in place (`signInRequired`), keeping `me` so nothing
   * unmounts; otherwise the signed-in user is forgotten and the shell sends them to sign in. Auth requests
   * are exempt: there a 401 means wrong credentials, which the form reports. Returns whether the session is
   * being resumed in place, in which case the sign-in panel says what happened and the error isn't toasted.
   */
  const handleSessionEnded = (error: unknown, isAuthRequest: boolean) => {
    if (!isUnauthorized(error) || isAuthRequest) {
      return false;
    }
    const session = useSessionStore.getState();
    if (hasUnsavedEdits() || session.signInRequired) {
      session.requireSignIn();
      return true;
    }
    queryClient.setQueryData(queryKeys.me, null);
    return false;
  };
  /** Re-reads `me`, whose `sites` decide whether the Shell shows the no-role state. */
  const handleSiteAccessLost = (error: unknown, isMeQuery: boolean) => {
    if (isSiteAccessError(error) && !isMeQuery) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const context = `query ${JSON.stringify(query.queryKey)}`;
        const isMeQuery = query.queryKey[0] === queryKeys.me[0];
        // `me` answers a 401 with null, except over unsaved edits, where it fails so the session resumes in place.
        const inPlace = handleSessionEnded(error, false);
        const quiet =
          query.meta?.silent ||
          (query.meta?.silentNotFound && isNotFound(error)) ||
          isSiteAccessError(error) ||
          inPlace;
        (quiet ? logError : reportError)(error, context);
        handleSiteAccessLost(error, isMeQuery);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const context = `mutation ${JSON.stringify(mutation.options.mutationKey ?? 'anonymous')}`;
        const inPlace = handleSessionEnded(error, AUTH_KEYS.has(String(mutation.options.mutationKey?.[0])));
        (mutation.meta?.silent || inPlace ? logError : reportError)(error, context);
        handleSiteAccessLost(error, false);
      },
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return queryClient;
};
