import type { ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { propertyLabel, valueLabel } from '../../helpers/labels';
import type { DescribedProperty } from '../../helpers/schemaControls';
import { ChoicesControl } from '../controls/ChoicesControl';
import { NumberControl } from '../controls/NumberControl';
import { SelectControl } from '../controls/SelectControl';
import { SwitchControl } from '../controls/SwitchControl';
import { TextControl } from '../controls/TextControl';

type PropertyControlProps = {
  idPrefix: string;
  property: DescribedProperty;
  value: unknown;
  onChange: (value: unknown) => void;
  issues: readonly ValidationIssue[];
  /** One visible line under the control: the text format to type. */
  description?: string;
  /** An explanation behind an info icon. */
  hint?: string;
  disabled?: boolean;
};

const LIST_SEPARATOR = /\s*,\s*/;

/**
 * One property of a settings or editor-options schema, rendered from its JSON Schema description. Labels
 * and choice names come from `models.properties.*` and `models.values.*`.
 */
export const PropertyControl = ({
  idPrefix,
  property: { key, control, required },
  value,
  onChange,
  issues,
  description,
  hint,
  disabled,
}: PropertyControlProps) => {
  const { t } = useTranslation();
  const id = `${idPrefix}-${key}`;
  const label = propertyLabel(key);
  const base = { id, label, issues, disabled, description, hint };
  switch (control.kind) {
    case 'boolean':
      return (
        <SwitchControl
          {...base}
          checked={value === true}
          onChange={(checked) => onChange(checked || undefined)}
        />
      );
    case 'integer':
    case 'number':
      return (
        <NumberControl
          {...base}
          integer={control.kind === 'integer'}
          min={control.minimum}
          max={control.kind === 'integer' ? control.maximum : undefined}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'choice':
      return (
        <SelectControl
          {...base}
          value={typeof value === 'string' ? value : undefined}
          options={control.options.map((option) => ({ value: option, label: valueLabel(option) }))}
          onChange={onChange}
          {...(required ? {} : { unsetLabel: t('models.notSet') })}
        />
      );
    case 'choices':
      return (
        <ChoicesControl
          {...base}
          value={Array.isArray(value) ? (value as string[]) : []}
          options={control.options.map((option) => ({ value: option, label: valueLabel(option) }))}
          onChange={(next) => onChange(next.length > 0 ? next : undefined)}
        />
      );
    case 'textList':
      return (
        <TextControl
          {...base}
          description={description ?? t('models.commaSeparated')}
          value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
          onChange={(text) => {
            const items = (text ?? '').split(LIST_SEPARATOR).filter(Boolean);
            onChange(items.length > 0 ? items : undefined);
          }}
        />
      );
    case 'text':
      return (
        <TextControl
          {...base}
          maxLength={control.maxLength}
          value={typeof value === 'string' ? value : undefined}
          onChange={onChange}
          emptyAsUndefined={!required}
        />
      );
    default:
      return null;
  }
};
