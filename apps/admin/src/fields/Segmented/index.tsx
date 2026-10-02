import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { choicesOf, fromChoice, toChoice } from '../helpers/choices';
import type { BuiltInEditorProps } from '../types';

/** `segmented`: a row of buttons for a boolean or a single-choice enum. Pressing the active one clears it. */
export const Segmented = (props: BuiltInEditorProps) => {
  const { labelId, describedBy, value, onChange, onBlur, readOnly, disabled, validation } = props;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={validation.invalid || undefined}
      value={toChoice(value)}
      disabled={disabled || readOnly}
      onValueChange={(choice) => onChange(fromChoice(props, choice))}
      onBlur={onBlur}
      className="flex-wrap"
    >
      {choicesOf(props).map((choice) => (
        <ToggleGroupItem key={choice.value} value={choice.value} className="px-3">
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};
