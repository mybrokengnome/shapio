import { useMemo } from 'react';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { isDraftDirty } from '../../helpers/draft';

/** Whether the draft differs from the active definition it is based on. */
export const useIsDraftDirty = () => {
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  return useMemo(() => Boolean(draft && base && isDraftDirty(draft, base)), [draft, base]);
};
