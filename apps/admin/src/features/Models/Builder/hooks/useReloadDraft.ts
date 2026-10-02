import type { DefinitionCategory } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { definitionQueryOptions } from '@/api/schema';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { rebaseDraft } from '../../helpers/rebase';

/**
 * Fetches the active definition again. `replace` starts over from it (the draft's edits are dropped);
 * `rebase` re-applies the draft's edits on top of it (three-way merge) and moves the expected version
 * forward, so the next review is planned against the latest version.
 */
export const useReloadDraft = (category: DefinitionCategory, id: string) => {
  const queryClient = useQueryClient();
  const load = useDefinitionDraftStore((state) => state.load);
  const rebase = useDefinitionDraftStore((state) => state.rebase);
  return useCallback(
    async (mode: 'replace' | 'rebase') => {
      const detail = await queryClient.fetchQuery({ ...definitionQueryOptions(category, id), staleTime: 0 });
      const { base, draft } = useDefinitionDraftStore.getState();
      if (mode === 'rebase' && base && draft) {
        rebase(detail.definition, detail.version, rebaseDraft(base, draft, detail.definition));
      } else {
        load(category, detail.definition, detail.version);
      }
      return detail;
    },
    [queryClient, category, id, load, rebase],
  );
};
