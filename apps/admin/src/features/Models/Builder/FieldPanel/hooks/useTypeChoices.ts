import { DATA_TYPES, type DataType, type FieldDefinition, type SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyFieldTypeChange } from '../../../helpers/typeChange';

const NO_TYPES: ReadonlySet<DataType> = new Set();

/**
 * The data types a field may take and what changing it means. A new field may take any type. A saved field
 * may take the types the planner can convert it to (its own included), the others are `unavailable`;
 * `notes` says what saving the chosen type does to existing values and the API.
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
  if (change?.category === 'conversion') {
    notes.push(t('models.builder.typeConverted'));
  } else if (change?.category === 'validation') {
    notes.push(t('models.builder.typeChecked'));
  }
  if (change?.breaking) {
    notes.push(t('models.builder.typeBreaking'));
  }
  if (change?.destructive) {
    notes.push(t('models.builder.typeDestructive'));
  }
  const from = saved ? t(`models.dataTypes.${saved.type}.name`) : '';
  const limitedNote = unavailable.size > 0 ? t('models.builder.typeLimited', { type: from }) : undefined;
  /** Why a type is unavailable, announced with its tile. */
  const unavailableReason = (to: DataType) =>
    t('models.builder.typeUnsupported', { from, to: t(`models.dataTypes.${to}.name`) });
  return { unavailable, unavailableReason, notes, limitedNote };
};
