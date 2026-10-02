import { useDefinitionDraftStore } from '@/stores/definitionDraft';

/** The field open in the settings panel and its position, or nothing when the definition is selected. */
export const useSelectedField = () => {
  const selection = useDefinitionDraftStore((state) => state.selection);
  const fields = useDefinitionDraftStore((state) => state.draft?.fields);
  if (selection.type !== 'field' || !fields) {
    return { field: undefined, index: -1 };
  }
  const index = fields.findIndex((candidate) => candidate.id === selection.fieldId);
  return { field: fields[index], index };
};
