import type { FieldProposal, SuggestedValue } from '@shapio/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type ValueEditorProps = {
  proposal: FieldProposal;
  value: SuggestedValue;
  onChange: (value: SuggestedValue) => void;
  /** Id of the control (and the base of an enum list's options' ids). */
  id: string;
  /** Id of the field's label, for the controls that aren't one input. */
  labelId: string;
  disabled: boolean;
};

const textOf = (value: SuggestedValue) => (Array.isArray(value) ? value.join(', ') : value);
const listOf = (value: SuggestedValue) => (Array.isArray(value) ? value : value === '' ? [] : [value]);

/**
 * The proposed value in the editor its type takes: one line (string), several (text), a select (an enum with
 * one value) or a list of checkboxes (an enum with several). Anything else is shown read-only.
 */
export const ValueEditor = ({ proposal, value, onChange, id, labelId, disabled }: ValueEditorProps) => {
  const { fieldType, maxLength, options, multiple } = proposal;
  if (fieldType === 'string') {
    return (
      <Input
        id={id}
        value={textOf(value)}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (fieldType === 'text') {
    return (
      <Textarea
        id={id}
        value={textOf(value)}
        rows={3}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (fieldType === 'enum' && options && options.length > 0) {
    if (multiple) {
      const selected = listOf(value);
      return (
        <div role="group" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const optionId = `${id}-${option.value}`;
            return (
              <Field key={option.value} orientation="horizontal">
                <Checkbox
                  id={optionId}
                  checked={selected.includes(option.value)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? options
                            .map((item) => item.value)
                            .filter((item) => item === option.value || selected.includes(item))
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                />
                <FieldLabel htmlFor={optionId} className="font-normal">
                  {option.label}
                </FieldLabel>
              </Field>
            );
          })}
        </div>
      );
    }
    return (
      <Select value={textOf(value)} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} aria-labelledby={labelId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <p id={id} className="text-sm break-words">
      {textOf(value)}
    </p>
  );
};
