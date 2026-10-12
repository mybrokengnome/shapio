import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { ClearButton } from '../ClearButton';
import { inputAria, textValue } from '../helpers/props';
import { useNativeDateInput } from '../hooks/useNativeDateInput';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

const asText = (text: string) => text;

/** `datePicker`: a calendar date stored as `YYYY-MM-DD`. A partly typed date is kept as a change, not cleared. */
export const DateInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, definition, field } = props;
  const settings = definition.type === 'date' ? definition.settings : {};
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
          type="date"
          value={text}
          min={settings.min}
          max={settings.max}
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
        message={native.incomplete ? t('content.fields.incomplete.date') : undefined}
      />
    </div>
  );
};
