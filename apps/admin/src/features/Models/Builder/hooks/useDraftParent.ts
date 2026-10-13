import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import type { DraftParent } from '../../helpers/inheritance';
import { useModelIndex } from '../../hooks/useModelIndex';

/**
 * The collection the draft extends, resolved over the active schema (its effective fields and display), or
 * undefined when it extends nothing or the parent is not in this site's schema.
 */
export const useDraftParent = (): { parent: DraftParent } => {
  const parentId = useDefinitionDraftStore((state) =>
    state.draft?.kind === 'collection' ? state.draft.extends : undefined,
  );
  const { index } = useModelIndex();
  return { parent: parentId === undefined ? undefined : index.resolve(parentId) };
};
