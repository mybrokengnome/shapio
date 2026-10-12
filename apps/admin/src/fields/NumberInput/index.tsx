import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { inputAria, numberOption, stringOption, textValue } from '../helpers/props';
import { isUnparsed, unparsedText } from '../helpers/unparsed';
import { isDeepEqual } from '../helpers/values';
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

/** The text a value shows as: unparsed text as typed, anything else as text. */
const textOf = (value: unknown) => (isUnparsed(value) ? value.text : textValue(value));

/** What typed text means for the form: the parsed value, or the text itself while it doesn't parse. */
const valueOf = (type: string, text: string): unknown => {
  const parsed = parse(type, text);
  return parsed.ok ? parsed.value : unparsedText(text);
};

/**
 * `numberInput`: number, integer, decimal and big integer. Typed as text so partial input ("1.", "-")
 * isn't lost. Text that doesn't parse goes to the form as unparsed text: the form counts it as a change
 * and refuses to save until it is fixed.
 */
export const NumberInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, definition } = props;
  const [text, setText] = useState(() => textOf(value));
  const [seen, setSeen] = useState(value);
  // Follow outside changes (reload, restore, copy from another locale) unless they match what's typed.
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (!isDeepEqual(valueOf(definition.type, text), value ?? null)) {
      setText(textOf(value));
    }
  }
  const invalid = isUnparsed(value);
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
          onChange(valueOf(definition.type, event.target.value));
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
