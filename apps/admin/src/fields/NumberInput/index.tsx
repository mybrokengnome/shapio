import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { inputAria, numberOption, stringOption, textValue } from '../helpers/props';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

const INTEGER = /^-?\d+$/;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Text → value: numbers for `number`/`integer`, canonical strings for `decimal`/`biginteger`. */
const parse = (type: string, text: string): { ok: true; value: number | string | null } | { ok: false } => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (type === 'decimal' || type === 'biginteger') {
    // Kept as typed: the format check (and the server) report anything that is not a canonical number.
    return { ok: true, value: trimmed };
  }
  if (!(type === 'integer' ? INTEGER : NUMBER).test(trimmed)) {
    return { ok: false };
  }
  const number = Number(trimmed);
  return Number.isFinite(number) && (type !== 'integer' || Number.isSafeInteger(number))
    ? { ok: true, value: number }
    : { ok: false };
};

/**
 * `numberInput`: number, integer, decimal and big integer. Typed as text so partial input ("1.", "-")
 * isn't lost; only text that parses is reported as the value.
 */
export const NumberInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, definition } = props;
  const [text, setText] = useState(() => textValue(value));
  const [invalid, setInvalid] = useState(false);
  const [seen, setSeen] = useState(value);
  // Follow outside changes (reload, restore, copy from another locale) unless they match what's typed.
  if (!Object.is(seen, value)) {
    setSeen(value);
    const parsed = parse(definition.type, text);
    if (!parsed.ok || parsed.value !== value) {
      setText(textValue(value));
      setInvalid(false);
    }
  }
  const parseErrorId = `${inputId}-parse`;
  const integer = definition.type === 'integer' || definition.type === 'biginteger';
  return (
    <div className="space-y-1">
      <Input
        {...inputAria(props, invalid ? parseErrorId : undefined)}
        aria-invalid={props.validation.invalid || invalid || undefined}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        placeholder={stringOption(props, 'placeholder')}
        step={numberOption(props, 'step')}
        readOnly={readOnly}
        disabled={disabled}
        className="tabular-nums"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parse(definition.type, event.target.value);
          setInvalid(!parsed.ok);
          if (parsed.ok) {
            onChange(parsed.value);
          }
        }}
        onBlur={onBlur}
      />
      <ParseError
        id={parseErrorId}
        message={
          invalid
            ? t(integer ? 'content.fields.number.notInteger' : 'content.fields.number.notNumber')
            : undefined
        }
      />
    </div>
  );
};
