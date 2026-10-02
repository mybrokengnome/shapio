import { useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/** Custom field editors the project installed. Changes only with a server restart, so read once. */
export const useEditorManifest = () =>
  useQuery({
    queryKey: queryKeys.editorManifest,
    queryFn: () => adminApi.extensions.editors(),
    staleTime: Infinity,
    meta: { silent: true },
  });
