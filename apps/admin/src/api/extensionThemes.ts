import { useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/**
 * Colour themes the project declares (`shapio.config`). Public (the sign-in screen lists them too) and fixed
 * until a server restart, so read once. Their CSS arrives separately, linked from index.html.
 */
export const useExtensionThemes = () =>
  useQuery({
    queryKey: queryKeys.extensionThemes,
    queryFn: () => adminApi.extensions.themes(),
    staleTime: Infinity,
    meta: { silent: true },
  });
