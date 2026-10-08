import type { CSSProperties, FocusEvent } from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeMirror } from '@/components/CodeMirror';
import { baseExtensions } from '@/components/CodeMirror/helpers/baseExtensions';
import { InfoHint } from '@/components/InfoHint';
import { valueLabel } from '@/features/Models/helpers/labels';
import { useShortcutLabel } from '@/features/Shell/hooks/useShortcutLabel';
import { cn } from '@/helpers/cn';
import { numberOption, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';
import { useLanguageExtension } from './hooks/useLanguageExtension';

const DEFAULT_ROWS = 12;

/**
 * `codeEditor`: a `code` field's text in CodeMirror, highlighted for the field's language (its pack loads on
 * demand). Shapio never changes the code: the text is the value, and an empty editor is `null`. Tab moves on,
 * as everywhere in the admin; the hint says how to indent. Loaded lazily with its own chunk.
 */
export const CodeEditor = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, labelId, describedBy, value, onChange, onBlur, readOnly, disabled, validation, field } =
    props;
  const language = props.definition.type === 'code' ? props.definition.settings.language : 'plain';
  const rows = numberOption(props, 'rows') ?? DEFAULT_ROWS;
  const hintId = `${inputId}-keys`;
  const indent = useShortcutLabel(']');
  const outdent = useShortcutLabel('[');
  const languageSupport = useLanguageExtension(language);
  const locked = readOnly || disabled;
  const extensions = useMemo(
    () => [
      ...baseExtensions({
        id: inputId,
        labelledBy: labelId,
        describedBy: [describedBy, hintId].filter(Boolean).join(' '),
        invalid: validation.invalid,
        readOnly: locked,
      }),
      languageSupport,
    ],
    [inputId, labelId, describedBy, hintId, validation.invalid, locked, languageSupport],
  );
  const handleChange = useCallback((text: string) => onChange(text === '' ? null : text), [onChange]);
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onBlur();
    }
  };
  return (
    <div className="space-y-1">
      <div
        onBlur={handleBlur}
        style={{ '--code-rows': rows } as CSSProperties}
        className={cn(
          'h-[calc(var(--code-rows)*1.3rem+1rem+2px)] overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          validation.invalid && 'border-destructive ring-destructive/20 dark:ring-destructive/40',
          disabled && 'opacity-50',
        )}
      >
        <CodeMirror value={textValue(value)} onChange={handleChange} extensions={extensions} />
      </div>
      <div className="flex items-center gap-1 text-meta text-muted-foreground">
        <span>{valueLabel(language)}</span>
        <InfoHint about={field.label} id={hintId}>
          {t('content.fields.code.keys', { indent, outdent })}
        </InfoHint>
      </div>
    </div>
  );
};
