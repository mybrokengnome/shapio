import type { FieldDefinition } from '@shapio/schema';
import { useAssistTarget } from '../form/assistTarget';
import { useFieldsEnvironment } from '../form/context';
import { isSuggestible } from '../helpers/assistEligibility';

/**
 * Whether a field gets "Suggest" (`FieldAssist`): assist can fill it (`isSuggestible`) and it belongs to an
 * existing, editable entry open in the document. Only then is `FieldAssist` rendered, so forms elsewhere (quick
 * edit, inline create, previews) never ask whether assist is on.
 */
export const useCanSuggest = (field: FieldDefinition, path: string): boolean => {
  const { model } = useFieldsEnvironment();
  const target = useAssistTarget();
  return target !== null && isSuggestible(model, field, path);
};
