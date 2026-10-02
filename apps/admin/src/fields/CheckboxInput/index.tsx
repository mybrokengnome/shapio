import { Checkbox } from '@/components/ui/checkbox';
import { inputAria } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

/** `checkbox`: a checkbox for booleans. */
export const CheckboxInput = (props: BuiltInEditorProps) => {
  const { value, onChange, onBlur, readOnly, disabled } = props;
  return (
    <Checkbox
      {...inputAria(props)}
      checked={value === true}
      disabled={disabled || readOnly}
      onCheckedChange={(checked) => onChange(checked === true)}
      onBlur={onBlur}
    />
  );
};
