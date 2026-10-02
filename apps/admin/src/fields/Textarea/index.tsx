import { useTranslation } from 'react-i18next';
import { Textarea as TextareaControl } from '@/components/ui/textarea';
import { inputAria, numberOption, stringOption, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

const DEFAULT_ROWS = 4;

/** `textarea`: several lines of plain text, with a character count when the field has a maximum. */
export const Textarea = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { inputId, value, onChange, onBlur, readOnly, disabled, definition } = props;
  const text = textValue(value);
  const maxLength = 'maxLength' in definition.settings ? definition.settings.maxLength : undefined;
  const countId = `${inputId}-count`;
  return (
    <div className="space-y-1">
      <TextareaControl
        {...inputAria(props, maxLength ? countId : undefined)}
        rows={numberOption(props, 'rows') ?? DEFAULT_ROWS}
        value={text}
        placeholder={stringOption(props, 'placeholder')}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        onBlur={onBlur}
      />
      {maxLength ? (
        <p id={countId} className="text-right text-meta text-muted-foreground tabular-nums">
          {t('content.fields.characterCount', { count: text.length, max: maxLength })}
        </p>
      ) : null}
    </div>
  );
};
