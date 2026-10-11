import { FIELD_WIDTHS, type FieldDefinition, type FieldWidth, type ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { withKey } from '../../../helpers/draft';
import { SelectControl } from '../../controls/SelectControl';

type WidthProps = {
  field: FieldDefinition;
  /** Issues under the field's `width`. */
  issues: readonly ValidationIssue[];
  disabled: boolean;
};

const WIDTH_LABEL_KEYS = {
  full: 'models.builder.widthFull',
  'two-thirds': 'models.builder.widthTwoThirds',
  half: 'models.builder.widthHalf',
  third: 'models.builder.widthThird',
} as const satisfies Record<FieldWidth, string>;

const isFieldWidth = (value: string | undefined): value is FieldWidth =>
  FIELD_WIDTHS.some((width) => width === value);

/** "Width": how much of a row the field takes in a form-layout entry. Full is the default, written as unset. */
export const Width = ({ field, issues, disabled }: WidthProps) => {
  const { t } = useTranslation();
  const updateField = useDefinitionDraftStore((state) => state.updateField);
  return (
    <SelectControl
      id={`field-${field.id}-width`}
      label={t('models.builder.width')}
      hint={t('models.builder.widthHint')}
      value={field.width ?? 'full'}
      options={FIELD_WIDTHS.map((value) => ({ value, label: t(WIDTH_LABEL_KEYS[value]) }))}
      onChange={(value) =>
        updateField(field.id, (current) =>
          withKey(current, 'width', isFieldWidth(value) && value !== 'full' ? value : undefined),
        )
      }
      issues={issues}
      disabled={disabled}
    />
  );
};
