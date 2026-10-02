import { InfoHint } from '@/components/InfoHint';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { IssueList } from '../IssueList';
import type { ControlBaseProps } from '../types';

type ChoicesControlProps = ControlBaseProps & {
  value: readonly string[];
  options: readonly { value: string; label: string }[];
  onChange: (value: string[]) => void;
  /** Options that can't be toggled (e.g. the last one of a list that may not be empty). */
  locked?: readonly string[];
};

/** A set of checkboxes; the value keeps the options' order. */
export const ChoicesControl = ({
  id,
  label,
  hint,
  description,
  issues = [],
  disabled,
  value,
  options,
  onChange,
  locked = [],
}: ChoicesControlProps) => {
  const toggle = (option: string, checked: boolean) => {
    const next = new Set(value);
    if (checked) {
      next.add(option);
    } else {
      next.delete(option);
    }
    onChange(options.map((entry) => entry.value).filter((entry) => next.has(entry)));
  };
  return (
    <FieldSet data-invalid={issues.length > 0 || undefined} className="gap-3">
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1">
        {label}
        {hint ? <InfoHint about={label}>{hint}</InfoHint> : null}
      </FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <div data-slot="checkbox-group" className="grid gap-3 @sm/field-group:grid-cols-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal">
              <Checkbox
                id={optionId}
                checked={value.includes(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
                disabled={disabled || locked.includes(option.value)}
              />
              <FieldLabel htmlFor={optionId} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          );
        })}
      </div>
      <IssueList issues={issues} />
    </FieldSet>
  );
};
