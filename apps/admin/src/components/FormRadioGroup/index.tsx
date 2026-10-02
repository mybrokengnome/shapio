import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FormFieldError } from '../FormFieldError';

export type RadioOption = { value: string; label: string; description?: string };

type FormRadioGroupProps<TValues extends FieldValues> = {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  legend: string;
  options: readonly RadioOption[];
  disabled?: boolean;
};

/**
 * A fieldset of radio buttons bound to a `string` form value: exactly one choice. Arrow keys move between
 * options and Tab enters at the checked one; each option's description is linked to its radio.
 */
export const FormRadioGroup = <TValues extends FieldValues>({
  control,
  name,
  legend,
  options,
  disabled,
}: FormRadioGroupProps<TValues>) => {
  const { field, fieldState } = useController({ control, name });
  const legendId = `field-${name}-legend`;
  const errorId = `field-${name}-error`;
  const errorMessage = fieldState.error?.message;
  return (
    <FieldSet data-invalid={fieldState.invalid || undefined}>
      <FieldLegend id={legendId} variant="label">
        {legend}
      </FieldLegend>
      <RadioGroup
        aria-labelledby={legendId}
        aria-describedby={errorMessage ? errorId : undefined}
        aria-invalid={fieldState.invalid || undefined}
        value={field.value ?? ''}
        onValueChange={field.onChange}
        onBlur={field.onBlur}
        disabled={disabled}
      >
        {options.map((option) => {
          const id = `field-${name}-${option.value}`;
          const descriptionId = option.description ? `${id}-description` : undefined;
          return (
            <Field key={option.value} orientation="horizontal">
              <RadioGroupItem id={id} value={option.value} aria-describedby={descriptionId} />
              <FieldContent>
                <FieldLabel htmlFor={id} className="font-normal">
                  {option.label}
                </FieldLabel>
                {option.description ? (
                  <FieldDescription id={descriptionId}>{option.description}</FieldDescription>
                ) : null}
              </FieldContent>
            </Field>
          );
        })}
      </RadioGroup>
      <FormFieldError id={errorId} message={errorMessage} />
    </FieldSet>
  );
};
