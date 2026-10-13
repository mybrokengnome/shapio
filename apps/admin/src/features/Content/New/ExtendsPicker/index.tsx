import type { ModelDefinition } from '@shapio/schema';
import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormSelectField } from '@/components/FormSelectField';
import { NO_PARENT, type CreateDefinitionValues } from '@/features/Models/hooks/useCreateDefinitionForm';

type ExtendsPickerProps = {
  control: Control<CreateDefinitionValues>;
  /** The collections available where the new one will be (this site's, or the shared ones). */
  choices: readonly ModelDefinition[];
};

/**
 * "Extends": a collection may be a kind of another one in the same place, getting its fields (locked) and a
 * nested API path. Off, with the reason, while there is no collection to extend.
 */
export const ExtendsPicker = ({ control, choices }: ExtendsPickerProps) => {
  const { t } = useTranslation();
  return (
    <FormSelectField
      control={control}
      name="extends"
      label={t('models.inheritance.extends')}
      hint={t('models.inheritance.extendsHint')}
      description={choices.length === 0 ? t('models.inheritance.noCollections') : undefined}
      disabled={choices.length === 0}
      options={[
        { value: NO_PARENT, label: t('models.inheritance.noParent') },
        ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
      ]}
    />
  );
};
