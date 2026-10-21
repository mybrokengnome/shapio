import type { InterfaceDefinition } from '@shapio/schema';
import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import type { CreateDefinitionValues } from '@/features/Models/hooks/useCreateDefinitionForm';

type ImplementsPickerProps = {
  control: Control<CreateDefinitionValues>;
  /** The interfaces available where the new type will be (shared ones, and this site's for a site type). */
  choices: readonly InterfaceDefinition[];
};

/**
 * "Implements": the interfaces the new type is a member of. Each one's contract fields are added to the
 * type when it is created, so it is valid at once; the hint beside each says which.
 */
export const ImplementsPicker = ({ control, choices }: ImplementsPickerProps) => {
  const { t } = useTranslation();
  if (choices.length === 0) {
    return null;
  }
  return (
    <FormCheckboxGroup
      control={control}
      name="implements"
      legend={t('common.optionalLabel', { label: t('models.implements.label') })}
      options={choices.map((choice) => ({
        value: choice.id,
        label: choice.label,
        hint:
          choice.fields.length === 0
            ? t('models.implements.requiresNothing')
            : t('models.implements.addsFields', {
                fields: choice.fields.map((field) => field.apiKey).join(', '),
              }),
      }))}
    />
  );
};
