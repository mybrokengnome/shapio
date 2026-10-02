import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/helpers/cn';
import { ClearButton } from '../ClearButton';
import { choicesOf, fromChoice, toChoice } from '../helpers/choices';
import { stringOption } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

/** `radio`: radio buttons for a single-choice enum, vertical or horizontal. */
export const RadioInput = (props: BuiltInEditorProps) => {
  const { inputId, labelId, describedBy, value, onChange, onBlur, readOnly, disabled, field, validation } =
    props;
  const current = toChoice(value);
  const horizontal = stringOption(props, 'layout') === 'horizontal';
  return (
    <div className="flex items-start gap-2">
      <RadioGroup
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={validation.invalid || undefined}
        value={current}
        disabled={disabled || readOnly}
        onValueChange={(choice) => onChange(fromChoice(props, choice))}
        onBlur={onBlur}
        className={cn(horizontal && 'flex flex-wrap gap-x-6')}
      >
        {choicesOf(props).map((choice) => (
          <div key={choice.value} className="flex items-center gap-2">
            <RadioGroupItem id={`${inputId}-${choice.value}`} value={choice.value} />
            <Label htmlFor={`${inputId}-${choice.value}`} className="font-normal">
              {choice.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {current && !field.required && !readOnly ? (
        <ClearButton label={field.label} disabled={disabled} onClear={() => onChange(null)} />
      ) : null}
    </div>
  );
};
