import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/helpers/cn';
import { choicesOf } from '../helpers/choices';
import { stringOption } from '../helpers/props';
import { toList } from '../helpers/values';
import type { BuiltInEditorProps } from '../types';

/** `checkboxGroup`: one checkbox per value of a multiple-choice enum. Values keep the enum's order. */
export const CheckboxGroup = (props: BuiltInEditorProps) => {
  const { inputId, labelId, describedBy, value, onChange, onBlur, readOnly, disabled, validation } = props;
  const selected = toList<string>(value);
  const choices = choicesOf(props);
  const horizontal = stringOption(props, 'layout') === 'horizontal';
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={validation.invalid || undefined}
      className={cn('grid gap-2', horizontal && 'flex flex-wrap gap-x-6')}
      onBlur={onBlur}
    >
      {choices.map((choice) => (
        <div key={choice.value} className="flex items-center gap-2">
          <Checkbox
            id={`${inputId}-${choice.value}`}
            checked={selected.includes(choice.value)}
            disabled={disabled || readOnly}
            onCheckedChange={(checked) => {
              const next = choices
                .map((item) => item.value)
                .filter((item) => (item === choice.value ? checked === true : selected.includes(item)));
              onChange(next.length > 0 ? next : null);
            }}
          />
          <Label htmlFor={`${inputId}-${choice.value}`} className="font-normal">
            {choice.label}
          </Label>
        </div>
      ))}
    </div>
  );
};
