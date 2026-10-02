import { Braces } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { inputAria, numberOption } from '../helpers/props';
import { isDeepEqual } from '../helpers/values';
import { ParseError } from '../ParseError';
import type { BuiltInEditorProps } from '../types';

const DEFAULT_ROWS = 8;
const INDENT = 2;

const format = (value: unknown) =>
  value === null || value === undefined ? '' : JSON.stringify(value, null, INDENT);

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

/** `jsonEditor`: any JSON value, as text. Only text that parses becomes the value; errors show inline. */
export const JsonEditor = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled } = props;
  const [text, setText] = useState(() => format(value));
  const [problem, setProblem] = useState<string | undefined>();
  const [seen, setSeen] = useState(value);
  // Follow outside changes (reload, restore, copy from another locale) unless they match what's typed.
  if (!Object.is(seen, value)) {
    setSeen(value);
    const parsed = parse(text);
    if (!parsed.ok || !isDeepEqual(parsed.value, value ?? null)) {
      setText(format(value));
      setProblem(undefined);
    }
  }
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
          const parsed = parse(event.target.value);
          setProblem(parsed.ok ? undefined : parsed.message);
          if (parsed.ok) {
            onChange(parsed.value);
          }
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
