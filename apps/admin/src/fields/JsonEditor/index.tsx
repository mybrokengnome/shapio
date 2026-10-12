import { Braces } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { inputAria, numberOption } from '../helpers/props';
import { isUnparsed, unparsedText } from '../helpers/unparsed';
import { isDeepEqual } from '../helpers/values';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

const DEFAULT_ROWS = 8;
const INDENT = 2;

const format = (value: unknown) =>
  value === null || value === undefined ? '' : JSON.stringify(value, null, INDENT);

/** The text a value shows as: unparsed text as typed, anything else formatted. */
const textOf = (value: unknown) => (isUnparsed(value) ? value.text : format(value));

const parse = (text: string): { ok: true; value: unknown } | { ok: false; message: string } => {
  if (text.trim() === '') {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** What typed text means for the form: the parsed value, or the text itself while it doesn't parse. */
const valueOf = (text: string): unknown => {
  const parsed = parse(text);
  return parsed.ok ? parsed.value : unparsedText(text);
};

/**
 * `jsonEditor`: any JSON value, as text. Text that doesn't parse goes to the form as unparsed text (the
 * error shows inline, the form counts it as a change and refuses to save until it is fixed).
 */
export const JsonEditor = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled } = props;
  const [text, setText] = useState(() => textOf(value));
  const [seen, setSeen] = useState(value);
  // Follow outside changes (reload, restore, copy from another locale) unless they match what's typed.
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (!isDeepEqual(valueOf(text), value ?? null)) {
      setText(textOf(value));
    }
  }
  const parsed = isUnparsed(value) ? parse(value.text) : undefined;
  const problem = parsed && !parsed.ok ? parsed.message : undefined;
  const errorId = `${inputId}-parse`;
  return (
    <div className="space-y-1">
      <Textarea
        {...inputAria(props, problem ? errorId : undefined)}
        aria-invalid={props.validation.invalid || problem !== undefined || undefined}
        rows={numberOption(props, 'rows') ?? DEFAULT_ROWS}
        value={text}
        spellCheck={false}
        readOnly={readOnly}
        disabled={disabled}
        className="font-mono text-sm"
        onChange={(event) => {
          setText(event.target.value);
          onChange(valueOf(event.target.value));
        }}
        onBlur={onBlur}
      />
      <div className="flex items-start justify-between gap-2">
        <ParseError
          id={errorId}
          message={problem ? t('content.fields.json.invalid', { reason: problem }) : undefined}
        />
        {!readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={disabled || problem !== undefined || text.trim() === ''}
            onClick={() => setText(format(value))}
          >
            <Braces aria-hidden="true" />
            {t('content.fields.json.format')}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
