import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { hasErrorCode, isForbidden, isNotFound, isUnauthorized } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { logError, reportError } from '@/helpers/reportError';

declare module '@tanstack/react-query' {
  interface Register {
    /** `silent`: logged but no toast, because the caller shows the error itself (inline form error, state view). */
    queryMeta: { silent?: boolean };
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
  failureCount < MAX_RETRIES && !isUnauthorized(error) && !isForbidden(error) && !isNotFound(error);

export const createQueryClient = () => {
  /**
   * Any 401 means the session ended (expired, revoked elsewhere, signed out in another tab): forget the
   * signed-in user so the shell sends them to sign in. Auth requests are exempt: there a 401 means wrong
   * credentials, which the form reports.
   */
  const handleSessionEnded = (error: unknown, isAuthRequest: boolean) => {
    if (isUnauthorized(error) && !isAuthRequest) {
      queryClient.setQueryData(queryKeys.me, null);
    }
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
        (query.meta?.silent || isSiteAccessError(error) ? logError : reportError)(error, context);
        handleSessionEnded(error, isMeQuery);
        handleSiteAccessLost(error, isMeQuery);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const context = `mutation ${JSON.stringify(mutation.options.mutationKey ?? 'anonymous')}`;
        (mutation.meta?.silent ? logError : reportError)(error, context);
        handleSessionEnded(error, AUTH_KEYS.has(String(mutation.options.mutationKey?.[0])));
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
