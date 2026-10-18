import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import { queryKeys } from './queryKeys';

/**
 * The running Shapio and Node versions (`GET /api/version`, public). Read once per page load: the server
 * only changes version by restarting, and an upgrade reloads the admin anyway.
 */
export const useServerVersion = () =>
  useQuery({
    queryKey: queryKeys.serverVersion,
    queryFn: ({ signal }) => apiClient.system.version(signal),
    staleTime: Infinity,
    meta: { silent: true },
  });
