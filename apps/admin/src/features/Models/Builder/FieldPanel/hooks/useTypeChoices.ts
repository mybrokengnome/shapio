import type { ClassifiedChange, DataType, FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyFieldTypeChange } from '../../../helpers/typeChange';

/** What saving does to stored values, by change category; any other change keeps them. */
const VALUE_NOTE_KEYS = {
  conversion: 'models.builder.typeConverted',
  validation: 'models.builder.typeChecked',
} as const satisfies Partial<Record<ClassifiedChange['category'], string>>;

const valueNoteKey = (category: ClassifiedChange['category']) =>
  category === 'conversion' || category === 'validation'
    ? VALUE_NOTE_KEYS[category]
    : 'models.builder.typeKept';

/**
 * What changing a field's data type means. A new field may take any type, and so may a saved one: `notes`
 * says what saving the chosen type does to existing values and the API. When Shapio can't convert the saved
 * type to the chosen one, `dropsValues` is true and the one note says every stored value will be dropped.
 */
export const useTypeChoices = (
  base: SchemaDefinition | null,
  saved: FieldDefinition | undefined,
  type: DataType,
) => {
  const { t } = useTranslation();
  const change = useMemo(
    () => (base && saved ? classifyFieldTypeChange(base, saved, type) : null),
    [base, saved, type],
  );
  if (!change || !saved) {
    return { notes: [], dropsValues: false };
  }
  if (change.dropsValues) {
    const note = t('models.builder.typeDropsValues', {
      from: t(`models.dataTypes.${saved.type}.name`),
      to: t(`models.dataTypes.${type}.name`),
    });
    return { notes: [note], dropsValues: true };
  }
  // Leads with the answer, then what happens to stored values, then the API impact.
  const notes = [t('models.builder.typeAllowed'), t(valueNoteKey(change.category))];
  if (change.breaking) {
    notes.push(t('models.builder.typeBreaking'));
  }
  if (change.destructive) {
    notes.push(t('models.builder.typeDestructive'));
  }
  return { notes, dropsValues: false };
};
