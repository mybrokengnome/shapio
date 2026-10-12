import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { fromDateTimeInput, localTimeZone, toDateTimeInput } from '../helpers/dates';
import { inputAria, stringOption } from '../helpers/props';
import { useNativeDateInput } from '../hooks/useNativeDateInput';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

/**
 * `dateTimePicker`: a moment in time, edited in local time (or UTC) and stored as canonical UTC text. A
 * partly typed date and time is kept as a change, not cleared.
 */
export const DateTimeInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, field } = props;
  const utc = stringOption(props, 'display') === 'utc';
  const inputRef = useRef<HTMLInputElement>(null);
  const native = useNativeDateInput({
    inputRef,
    value,
    onChange,
    onBlur,
    parse: (text) => fromDateTimeInput(text, utc),
  });
  const hintId = `${inputId}-zone`;
  const parseErrorId = `${inputId}-parse`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          {...inputAria(props, native.incomplete ? `${parseErrorId} ${hintId}` : hintId)}
          aria-invalid={props.validation.invalid || native.incomplete || undefined}
          ref={inputRef}
          type="datetime-local"
          step={1}
          value={toDateTimeInput(value, utc)}
          readOnly={readOnly}
          disabled={disabled}
          // Fills its column like a text input (a form's width setting sizes the column, not the control).
          className="min-w-0 flex-1"
          onChange={native.onChange}
          onKeyUp={native.onKeyUp}
          onBlur={native.onBlur}
        />
        {(value || native.incomplete) && !readOnly ? (
          <ClearButton label={field.label} disabled={disabled} onClear={native.clear} />
        ) : null}
      </div>
      <ParseError
        id={parseErrorId}
        message={native.incomplete ? t('content.fields.incomplete.dateTime') : undefined}
      />
      <p id={hintId} className="text-meta text-muted-foreground">
        {utc
          ? t('content.fields.dateTime.utc')
          : t('content.fields.dateTime.local', { zone: localTimeZone() })}
      </p>
    </div>
  );
};
