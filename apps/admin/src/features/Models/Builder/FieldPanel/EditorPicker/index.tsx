import {
  EDITOR_CATALOGUE,
  isCustomEditorId,
  listCompatibleEditors,
  type FieldDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { withKey } from '../../../helpers/draft';
import { issuesUnder } from '../../../helpers/issues';
import { editorLabel } from '../../../helpers/labels';
import { describeProperties } from '../../../helpers/schemaControls';
import { SelectControl } from '../../controls/SelectControl';
import { PropertyControl } from '../../PropertyControl';

type EditorPickerProps = {
  field: FieldDefinition;
  path: string;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (editor: FieldDefinition['editor']) => void;
};

/**
 * The editor (input control) for a field, from the catalogue's editors compatible with its data type, and
 * that editor's options, rendered from its option schema. Changing it never changes stored data.
 */
export const EditorPicker = ({ field, path, issues, disabled, onChange }: EditorPickerProps) => {
  const { t } = useTranslation();
  const { id, options } = field.editor;
  const compatible = listCompatibleEditors(field).map((entry) => entry.id);
  const choices = isCustomEditorId(id) || !compatible.includes(id) ? [...compatible, id] : compatible;
  const entry = EDITOR_CATALOGUE.get(id);
  const properties = entry ? describeProperties(entry.optionsSchema) : [];
  return (
    <>
      <SelectControl
        id={`field-${field.id}-editor`}
        label={t('models.builder.editor')}
        hint={t('models.builder.editorHint')}
        value={id}
        options={choices.map((choice) => ({ value: choice, label: editorLabel(choice) }))}
        onChange={(next) => next && onChange({ id: next, options: {} })}
        issues={issuesUnder(issues, `${path}/editor/id`)}
        disabled={disabled}
      />
      {properties.map((property) => (
        <PropertyControl
          key={`${id}-${property.key}`}
          idPrefix={`field-${field.id}-editor-options`}
          property={property}
          value={options[property.key]}
          onChange={(value) => onChange({ id, options: withKey(options, property.key, value) })}
          issues={issuesUnder(issues, `${path}/editor/options/${property.key}`)}
          disabled={disabled}
        />
      ))}
    </>
  );
};
