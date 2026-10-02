import { canonicalJson, type FieldDefinition } from '@shapio/schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { withAddedField } from '../../helpers/display';
import { createField, removeField } from '../../helpers/draft';
import { uniqueNewFieldName } from '../../helpers/newField';

/** The field list's "Add field" button (focus goes back there when a new field is discarded). */
export const ADD_FIELD_BUTTON_ID = 'add-field-button';

/** The DOM ID of a field's label input in the properties panel (see `FieldPanel`). */
export const labelInputIdOf = (fieldId: string) => `field-${fieldId}-label`;

const afterRender = (run: () => void) => requestAnimationFrame(run);

/**
 * "Add field" adds a short-text field named "New field" (numbered when taken) to the draft at once, selects
 * it and puts the cursor in its label, text selected, so typing names it. A new field left exactly as it was
 * added can be discarded again (Escape in its panel). Nothing is saved until the plan is reviewed and applied.
 */
export const useNewField = () => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const select = useDefinitionDraftStore((state) => state.select);
  const [added, setAdded] = useState<FieldDefinition | null>(null);

  const add = () => {
    const { draft } = useDefinitionDraftStore.getState();
    if (!draft) {
      return;
    }
    const field = createField(draft, {
      type: 'string',
      ...uniqueNewFieldName(draft, t('models.builder.newField')),
    });
    update((current) => withAddedField(current, field));
    select({ type: 'field', fieldId: field.id });
    setAdded(field);
    afterRender(() => {
      const input = document.getElementById(labelInputIdOf(field.id));
      if (input instanceof HTMLInputElement) {
        input.scrollIntoView({ block: 'center' });
        input.focus({ preventScroll: true });
        input.select();
      }
    });
  };

  /** Whether `field` is the field just added, still untouched. */
  const isUntouched = (field: FieldDefinition) =>
    added !== null && field.id === added.id && canonicalJson(field) === canonicalJson(added);

  const discard = (fieldId: string) => {
    update((current) => removeField(current, fieldId));
    select({ type: 'definition' });
    setAdded(null);
    afterRender(() => document.getElementById(ADD_FIELD_BUTTON_ID)?.focus());
  };

  return { add, isUntouched, discard };
};
