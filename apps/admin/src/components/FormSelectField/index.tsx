import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldDescription } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describedBy } from '@/helpers/describedBy';
import { FormFieldError } from '../FormFieldError';
import { HintedLabel } from '../HintedLabel';

export type SelectOption = { value: string; label: string };

type FormSelectFieldProps<TValues extends FieldValues> = {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  /** Explanation behind an info icon next to the label (DESIGN.md, helper-text rule). */
  hint?: string;
  description?: string;
  placeholder?: string;
  options: readonly SelectOption[];
  disabled?: boolean;
};

export const FormSelectField = <TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  description,
  placeholder,
  options,
  disabled,
}: FormSelectFieldProps<TValues>) => {
  const {
    field: { ref, onBlur, onChange, value, name: fieldName },
    fieldState,
  } = useController({ control, name });
  const id = `field-${name}`;
  const errorMessage = fieldState.error?.message;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={hintId} />
      <Select
        name={fieldName}
        value={typeof value === 'string' ? value : ''}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          ref={ref}
          onBlur={onBlur}
          aria-invalid={fieldState.invalid || undefined}
          aria-describedby={describedBy(
            hintId,
            description && `${id}-description`,
            errorMessage && `${id}-error`,
          )}
          className="w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      <FormFieldError id={`${id}-error`} message={errorMessage} />
    </Field>
  );
};
