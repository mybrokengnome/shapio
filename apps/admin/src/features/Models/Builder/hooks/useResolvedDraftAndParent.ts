import type { SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { resolveDraft, type DraftParent } from '../../helpers/inheritance';
import { useDraftParent } from './useDraftParent';

/**
 * The draft with its inherited fields and display (see `resolveDraft`), and its parent: what the display
 * settings, title candidates and layout previews read. Edits still go to the draft (own fields only).
 */
export const useResolvedDraftAndParent = (): { resolved: SchemaDefinition | null; parent: DraftParent } => {
  const draft = useDefinitionDraftStore((state) => state.draft);
  const { parent } = useDraftParent();
  const resolved = useMemo(() => (draft ? resolveDraft(draft, parent) : null), [draft, parent]);
  return { resolved, parent };
};
