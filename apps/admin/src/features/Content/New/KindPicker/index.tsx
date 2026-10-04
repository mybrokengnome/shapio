import type { DefinitionKind } from '@shapio/schema';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { RadioTile } from '@/components/RadioTile';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { KIND_DESCRIPTION_KEYS, KIND_ICONS, KIND_LABEL_KEYS } from '@/features/Models/constants';
import type { CreateDefinitionValues } from '@/features/Models/hooks/useCreateDefinitionForm';
import { cn } from '@/helpers/cn';

type KindPickerProps = { control: Control<CreateDefinitionValues>; kinds: readonly DefinitionKind[] };

/** The kinds offered here as cards (a radio group: arrow keys move between them). */
export const KindPicker = ({ control, kinds }: KindPickerProps) => {
  const { t } = useTranslation();
  const {
    field: { ref, value, onChange },
  } = useController({ control, name: 'kind' });
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label" className="mb-0">
        {t('models.kind')}
      </FieldLegend>
      <RadioGroup
        ref={ref}
        value={value}
        onValueChange={onChange}
        className={cn('gap-3 sm:grid-cols-2', kinds.length > 2 && 'sm:grid-cols-3')}
      >
        {kinds.map((kind) => (
          <RadioTile
            key={kind}
            value={kind}
            icon={KIND_ICONS[kind]}
            label={t(KIND_LABEL_KEYS[kind])}
            description={t(KIND_DESCRIPTION_KEYS[kind])}
          />
        ))}
      </RadioGroup>
    </FieldSet>
  );
};
