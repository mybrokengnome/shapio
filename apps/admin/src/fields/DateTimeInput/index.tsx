import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { fromDateTimeInput, localTimeZone, toDateTimeInput } from '../helpers/dates';
import { inputAria, stringOption } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

/** `dateTimePicker`: a moment in time, edited in local time (or UTC) and stored as canonical UTC text. */
export const DateTimeInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, field } = props;
  const utc = stringOption(props, 'display') === 'utc';
  const hintId = `${inputId}-zone`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          {...inputAria(props, hintId)}
          type="datetime-local"
          step={1}
          value={toDateTimeInput(value, utc)}
          readOnly={readOnly}
          disabled={disabled}
          className="w-auto"
          onChange={(event) => onChange(fromDateTimeInput(event.target.value, utc))}
          onBlur={onBlur}
        />
        {value && !readOnly ? (
          <ClearButton label={field.label} disabled={disabled} onClear={() => onChange(null)} />
        ) : null}
      </div>
      <p id={hintId} className="text-meta text-muted-foreground">
        {utc
          ? t('content.fields.dateTime.utc')
          : t('content.fields.dateTime.local', { zone: localTimeZone() })}
      </p>
    </div>
  );
};
