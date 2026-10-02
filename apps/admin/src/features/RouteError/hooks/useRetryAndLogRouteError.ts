import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { logError } from '@/helpers/reportError';

/** Logs the route's error once, and returns `retry`: clear the error boundary and load the route again. */
export const useRetryAndLogRouteError = (error: unknown, reset: () => void) => {
  const router = useRouter();
  useEffect(() => {
    logError(error, 'loading or rendering a route');
  }, [error]);
  const retry = useCallback(() => {
    reset();
    void router.invalidate();
  }, [reset, router]);
  return { retry };
};
