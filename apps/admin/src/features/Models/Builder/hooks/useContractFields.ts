import { createDefinitionIndex, isModelDefinition } from '@shapio/schema';
import { useDeferredValue, useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { useModelIndex } from '../../hooks/useModelIndex';

const NONE: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The draft's fields that satisfy an interface's contract, by field ID, with the names of the interfaces
 * that require them (the "Required by Featurable" badge and the field panel's note). Fields that satisfy one
 * in the active schema stay listed while the draft breaks them (renamed, retyped), so the reason shows where
 * the change was made; fields that start satisfying one in the draft are listed too.
 */
export const useContractFields = (): { contractFields: ReadonlyMap<string, readonly string[]> } => {
  const draft = useDeferredValue(useDefinitionDraftStore((state) => state.draft));
  const { index } = useModelIndex();
  const { definitions } = useAllDefinitions();
  const contractFields = useMemo(() => {
    if (!draft || !isModelDefinition(draft)) {
      return NONE;
    }
    const proposed = createDefinitionIndex([
      ...(definitions ?? [])
        .map(({ definition }) => definition)
        .filter((definition) => definition.id !== draft.id),
      draft,
    ]);
    // Only interfaces the draft still implements count: removing one from Implements frees its fields.
    const implemented = new Set(proposed.interfacesOf(draft.id));
    const byField = new Map<string, Set<string>>();
    for (const map of [index.contractFieldsOf(draft.id), proposed.contractFieldsOf(draft.id)]) {
      for (const [fieldId, interfaceIds] of map) {
        const names = byField.get(fieldId) ?? new Set<string>();
        for (const interfaceId of interfaceIds.filter((id) => implemented.has(id))) {
          names.add(proposed.get(interfaceId)?.label ?? index.get(interfaceId)?.label ?? interfaceId);
        }
        if (names.size > 0) {
          byField.set(fieldId, names);
        }
      }
    }
    return new Map([...byField].map(([fieldId, names]) => [fieldId, [...names]]));
  }, [draft, index, definitions]);
  return { contractFields };
};
