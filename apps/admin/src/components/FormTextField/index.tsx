import type { ComponentProps, ReactNode } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describedBy } from '@/helpers/describedBy';
import { FormFieldError } from '../FormFieldError';
import { HintedLabel } from '../HintedLabel';

type InputProps = Omit<ComponentProps<typeof Input>, 'name' | 'value' | 'onChange' | 'onBlur' | 'id'>;

type FormTextFieldProps<TValues extends FieldValues> = InputProps & {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  /** Explanation behind an info icon next to the label (DESIGN.md, helper-text rule). */
  hint?: string;
  /** One short visible line, only when it changes what the person does. */
  description?: string;
  /** Shown under the hint, e.g. a live preview of what the value produces. */
  extra?: ReactNode;
};

/**
 * A labelled text input bound to react-hook-form: visible label, optional hint, inline translated error,
 * `aria-invalid` and `aria-describedby` wired for screen readers.
 */
export const FormTextField = <TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  description,
  extra,
  ...inputProps
}: FormTextFieldProps<TValues>) => {
  const { field, fieldState } = useController({ control, name });
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = fieldState.error ? `${id}-error` : undefined;
  const errorMessage = fieldState.error?.message;
  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={hintId} />
      <Input
        {...inputProps}
        {...field}
        value={field.value ?? ''}
        id={id}
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={describedBy(hintId, descriptionId, errorId)}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {extra}
      <FormFieldError id={errorId} message={errorMessage} />
    </Field>
  );
};
