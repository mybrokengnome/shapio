import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isForbidden, isNotFound, isUnauthorized } from '@/api/errors';
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
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const context = `query ${JSON.stringify(query.queryKey)}`;
        (query.meta?.silent ? logError : reportError)(error, context);
        handleSessionEnded(error, query.queryKey[0] === queryKeys.me[0]);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const context = `mutation ${JSON.stringify(mutation.options.mutationKey ?? 'anonymous')}`;
        (mutation.meta?.silent ? logError : reportError)(error, context);
        handleSessionEnded(error, AUTH_KEYS.has(String(mutation.options.mutationKey?.[0])));
      },
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return queryClient;
};
