import type { ComponentProps } from 'react';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { describedBy } from '@/helpers/describedBy';
import { FormFieldError } from '../FormFieldError';
import { HintedLabel } from '../HintedLabel';

type TextareaProps = Omit<ComponentProps<typeof Textarea>, 'name' | 'value' | 'onChange' | 'onBlur' | 'id'>;

type FormTextareaFieldProps<TValues extends FieldValues> = TextareaProps & {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  /** Explanation behind an info icon next to the label (DESIGN.md, helper-text rule). */
  hint?: string;
};

export const FormTextareaField = <TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  ...textareaProps
}: FormTextareaFieldProps<TValues>) => {
  const { field, fieldState } = useController({ control, name });
  const id = `field-${name}`;
  const errorMessage = fieldState.error?.message;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={hintId} />
      <Textarea
        {...textareaProps}
        {...field}
        value={field.value ?? ''}
        id={id}
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={describedBy(hintId, errorMessage && `${id}-error`)}
      />
      <FormFieldError id={`${id}-error`} message={errorMessage} />
    </Field>
  );
};
