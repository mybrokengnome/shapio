import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { inputAria, numberOption, textValue } from '../helpers/props';
import { useNativeDateInput } from '../hooks/useNativeDateInput';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

const SECONDS_PER_MINUTE = 60;

const asText = (text: string) => text;

/**
 * `timePicker`: a time of day stored as `HH:mm` (or `HH:mm:ss`), with an optional minute step. A partly
 * typed time is kept as a change, not cleared.
 */
export const TimeInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, field } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const native = useNativeDateInput({
    inputRef,
    value,
    onChange,
    onBlur,
    parse: asText,
  });
  const text = textValue(value);
  const parseErrorId = `${inputId}-parse`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          {...inputAria(props, native.incomplete ? parseErrorId : undefined)}
          aria-invalid={props.validation.invalid || native.incomplete || undefined}
          ref={inputRef}
          type="time"
          value={text}
          step={(numberOption(props, 'stepMinutes') ?? 1) * SECONDS_PER_MINUTE}
          readOnly={readOnly}
          disabled={disabled}
          className="w-auto"
          onChange={native.onChange}
          onKeyUp={native.onKeyUp}
          onBlur={native.onBlur}
        />
        {(text || native.incomplete) && !readOnly ? (
          <ClearButton label={field.label} disabled={disabled} onClear={native.clear} />
        ) : null}
      </div>
      <ParseError
        id={parseErrorId}
        message={native.incomplete ? t('content.fields.incomplete.time') : undefined}
      />
    </div>
  );
};
