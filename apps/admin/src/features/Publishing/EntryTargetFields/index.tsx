import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormSelectField } from '@/components/FormSelectField';
import { FormTextField } from '@/components/FormTextField';
import type { EntryTargetValues } from '../helpers/entryTarget';
import { useEntryTargetOptions } from '../hooks/useEntryTargetOptions';

type EntryTargetFieldsProps<TValues extends FieldValues & EntryTargetValues> = {
  control: Control<TValues>;
};

/** Model, entry ID, locale and action: the entry a scheduled publication acts on. */
export const EntryTargetFields = <TValues extends FieldValues & EntryTargetValues>({
  control,
}: EntryTargetFieldsProps<TValues>) => {
  const { t } = useTranslation();
  const { modelOptions, localeOptions, actionOptions } = useEntryTargetOptions();
  const path = (name: keyof EntryTargetValues) => name as FieldPath<TValues>;
  return (
    <>
      <FormSelectField
        control={control}
        name={path('modelKey')}
        label={t('publishing.fields.model')}
        placeholder={t('publishing.fields.modelPlaceholder')}
        options={modelOptions}
      />
      <FormTextField
        control={control}
        name={path('entryId')}
        label={t('publishing.fields.entryId')}
        hint={t('publishing.fields.entryIdHint')}
        autoComplete="off"
        className="font-mono text-sm"
      />
      <FormSelectField
        control={control}
        name={path('locale')}
        label={t('publishing.fields.locale')}
        hint={t('publishing.fields.localeHint')}
        options={localeOptions}
      />
      <FormSelectField
        control={control}
        name={path('action')}
        label={t('publishing.fields.action')}
        options={actionOptions}
      />
    </>
  );
};
