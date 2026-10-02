import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { inputAria, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

/** `datePicker`: a calendar date stored as `YYYY-MM-DD`. */
export const DateInput = (props: BuiltInEditorProps) => {
  const { value, onChange, onBlur, readOnly, disabled, definition, field } = props;
  const settings = definition.type === 'date' ? definition.settings : {};
  const text = textValue(value);
  return (
    <div className="flex items-center gap-1">
      <Input
        {...inputAria(props)}
        type="date"
        value={text}
        min={settings.min}
        max={settings.max}
        readOnly={readOnly}
        disabled={disabled}
        className="w-auto"
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        onBlur={onBlur}
      />
      {text && !readOnly ? (
        <ClearButton label={field.label} disabled={disabled} onClear={() => onChange(null)} />
      ) : null}
    </div>
  );
};
