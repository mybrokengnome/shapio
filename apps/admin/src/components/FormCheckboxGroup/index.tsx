import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { FormFieldError } from '../FormFieldError';
import { InfoHint } from '../InfoHint';

export type CheckboxOption = {
  value: string;
  label: string;
  description?: string;
  /** An explanation behind an info icon beside the option's label (DESIGN.md, helper-text rule). */
  hint?: string;
};

type FormCheckboxGroupProps<TValues extends FieldValues> = {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  legend: string;
  description?: string;
  options: readonly CheckboxOption[];
  disabled?: boolean;
};

/** A fieldset of checkboxes bound to a `string[]` form value. */
export const FormCheckboxGroup = <TValues extends FieldValues>({
  control,
  name,
  legend,
  description,
  options,
  disabled,
}: FormCheckboxGroupProps<TValues>) => {
  const { field, fieldState } = useController({ control, name });
  const selected = (field.value as string[] | undefined) ?? [];
  const toggle = (value: string, checked: boolean) =>
    field.onChange(checked ? [...selected, value] : selected.filter((item) => item !== value));
  const errorMessage = fieldState.error?.message;
  return (
    <FieldSet data-invalid={fieldState.invalid || undefined}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <div data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const id = `field-${name}-${option.value}`;
          const hintId = option.hint ? `${id}-hint` : undefined;
          return (
            <Field key={option.value} orientation="horizontal">
              <Checkbox
                id={id}
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
                onBlur={field.onBlur}
                disabled={disabled}
                aria-describedby={hintId}
              />
              {option.hint ? (
                <span className="flex items-center gap-1">
                  <FieldLabel htmlFor={id} className="font-normal">
                    {option.label}
                  </FieldLabel>
                  <InfoHint about={option.label} id={hintId}>
                    {option.hint}
                  </InfoHint>
                </span>
              ) : (
                <FieldLabel htmlFor={id} className="font-normal">
                  {option.label}
                </FieldLabel>
              )}
            </Field>
          );
        })}
      </div>
      <FormFieldError message={errorMessage} />
    </FieldSet>
  );
};
