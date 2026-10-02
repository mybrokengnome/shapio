import { Input } from '@/components/ui/input';
import { inputAria, stringOption, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

const INPUT_TYPES: Partial<Record<string, 'email' | 'url'>> = { email: 'email', url: 'url' };

/** `textInput`: one line of text (string, email, URL, UID). */
export const TextInput = (props: BuiltInEditorProps) => {
  const { value, onChange, onBlur, readOnly, disabled, definition } = props;
  const maxLength = 'maxLength' in definition.settings ? definition.settings.maxLength : undefined;
  return (
    <Input
      {...inputAria(props)}
      type={INPUT_TYPES[definition.type] ?? 'text'}
      value={textValue(value)}
      placeholder={stringOption(props, 'placeholder')}
      maxLength={maxLength}
      readOnly={readOnly}
      disabled={disabled}
      spellCheck={definition.type === 'string'}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      onBlur={onBlur}
    />
  );
};
