import type { DefinitionListItem } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useMe } from '@/api/auth';
import { queryKeys } from '@/api/queryKeys';

/**
 * `me.modelPermissions` is keyed by model ID and read once a minute, so a model created since (here or in
 * another session) is missing from it. When the registry shows such a model, re-read `me` once for it.
 */
export const useModelPermissionsRefresh = (definitions: readonly DefinitionListItem[] | undefined) => {
  const queryClient = useQueryClient();
  const { data: me, isFetching } = useMe();
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!me || !definitions || isFetching) {
      return;
    }
    const unknown = definitions
      .map(({ definition }) => definition.id)
      .filter((id) => !(id in me.modelPermissions) && !asked.current.has(id));
    if (unknown.length > 0) {
      for (const id of unknown) {
        asked.current.add(id);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    }
  }, [definitions, me, isFetching, queryClient]);
};
