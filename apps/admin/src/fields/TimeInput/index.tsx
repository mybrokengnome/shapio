import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { inputAria, numberOption, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

const SECONDS_PER_MINUTE = 60;

/** `timePicker`: a time of day stored as `HH:mm` (or `HH:mm:ss`), with an optional minute step. */
export const TimeInput = (props: BuiltInEditorProps) => {
  const { value, onChange, onBlur, readOnly, disabled, field } = props;
  const text = textValue(value);
  return (
    <div className="flex items-center gap-1">
      <Input
        {...inputAria(props)}
        type="time"
        value={text}
        step={(numberOption(props, 'stepMinutes') ?? 1) * SECONDS_PER_MINUTE}
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
