import {
  DATA_TYPES,
  type ClassifiedChange,
  type DataType,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyFieldTypeChange } from '../../../helpers/typeChange';

const NO_TYPES: ReadonlySet<DataType> = new Set();

/** What saving does to stored values, by change category; any other supported change keeps them. */
const VALUE_NOTE_KEYS = {
  conversion: 'models.builder.typeConverted',
  validation: 'models.builder.typeChecked',
} as const satisfies Partial<Record<ClassifiedChange['category'], string>>;

const valueNoteKey = (category: ClassifiedChange['category']) =>
  category === 'conversion' || category === 'validation'
    ? VALUE_NOTE_KEYS[category]
    : 'models.builder.typeKept';

/**
 * The data types a field may take and what changing it means. A new field may take any type. A saved field
 * may take the types the planner can convert it to (its own included), the others are `unavailable`;
 * `notes` says whether the chosen type can be saved, then what saving it does to existing values and the API.
 */
export const useTypeChoices = (
  base: SchemaDefinition | null,
  saved: FieldDefinition | undefined,
  type: DataType,
) => {
  const { t } = useTranslation();
  const unavailable = useMemo(
    () =>
      base && saved
        ? new Set(DATA_TYPES.filter((to) => classifyFieldTypeChange(base, saved, to)?.supported === false))
        : NO_TYPES,
    [base, saved],
  );
  const change = useMemo(
    () => (base && saved ? classifyFieldTypeChange(base, saved, type) : null),
    [base, saved, type],
  );
  const notes: string[] = [];
  // A supported change leads with the answer, then what happens to stored values, then the API impact.
  if (change && change.supported !== false) {
    notes.push(t('models.builder.typeAllowed'));
    notes.push(t(valueNoteKey(change.category)));
    if (change.breaking) {
      notes.push(t('models.builder.typeBreaking'));
    }
    if (change.destructive) {
      notes.push(t('models.builder.typeDestructive'));
    }
  }
  const from = saved ? t(`models.dataTypes.${saved.type}.name`) : '';
  const limitedNote = unavailable.size > 0 ? t('models.builder.typeLimited', { type: from }) : undefined;
  /** Why a type is unavailable, announced with its tile. */
  const unavailableReason = (to: DataType) =>
    t('models.builder.typeUnsupported', { from, to: t(`models.dataTypes.${to}.name`) });
  return { unavailable, unavailableReason, notes, limitedNote };
};
