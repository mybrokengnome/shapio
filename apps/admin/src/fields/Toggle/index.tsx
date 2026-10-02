import { Switch } from '@/components/ui/switch';
import { inputAria } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

/** `toggle`: an on/off switch for booleans. */
export const Toggle = (props: BuiltInEditorProps) => {
  const { value, onChange, onBlur, readOnly, disabled } = props;
  return (
    <Switch
      {...inputAria(props)}
      checked={value === true}
      disabled={disabled || readOnly}
      onCheckedChange={(checked) => onChange(checked)}
      onBlur={onBlur}
    />
  );
};
