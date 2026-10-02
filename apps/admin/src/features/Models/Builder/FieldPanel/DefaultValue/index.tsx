import type { FieldDefinition, JsonValue, ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { NumberControl } from '../../controls/NumberControl';
import { SelectControl } from '../../controls/SelectControl';
import { TextControl } from '../../controls/TextControl';

type DefaultValueProps = {
  field: FieldDefinition;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (value: JsonValue | undefined) => void;
};

/** The value new entries start with, also used to fill existing entries when the field becomes required. */
export const DefaultValue = ({ field, issues, disabled, onChange }: DefaultValueProps) => {
  const { t } = useTranslation();
  const common = {
    id: `field-${field.id}-default`,
    label: t('models.builder.defaultValue'),
    hint: t('models.builder.defaultValueHint'),
    issues,
    disabled,
  };
  const value = field.defaultValue;
  if (field.type === 'number' || field.type === 'integer') {
    return (
      <NumberControl
        {...common}
        integer={field.type === 'integer'}
        value={typeof value === 'number' ? value : undefined}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'boolean') {
    return (
      <SelectControl
        {...common}
        value={typeof value === 'boolean' ? String(value) : undefined}
        options={[
          { value: 'true', label: t('models.builder.booleanTrue') },
          { value: 'false', label: t('models.builder.booleanFalse') },
        ]}
        unsetLabel={t('models.notSet')}
        onChange={(next) => onChange(next === undefined ? undefined : next === 'true')}
      />
    );
  }
  if (field.type === 'enum') {
    return (
      <SelectControl
        {...common}
        value={typeof value === 'string' ? value : undefined}
        options={field.settings.values
          .filter((entry) => entry.value !== '')
          .map((entry) => ({ value: entry.value, label: entry.label || entry.value }))}
        unsetLabel={t('models.notSet')}
        onChange={onChange}
      />
    );
  }
  return (
    <TextControl
      {...common}
      value={typeof value === 'string' ? value : undefined}
      onChange={onChange}
      emptyAsUndefined
    />
  );
};
