import { cva } from 'class-variance-authority';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldContent, FieldDescription } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { describedBy } from '@/helpers/describedBy';
import { FormFieldError } from '../FormFieldError';
import { HintedLabel } from '../HintedLabel';

const switchFieldVariants = cva('', {
  variants: {
    variant: {
      plain: '',
      /** A bordered row: label and hint on the left, the switch on the right. */
      bordered: 'gap-4 rounded-lg border bg-card p-4',
    },
  },
  defaultVariants: { variant: 'plain' },
});

type FormSwitchFieldProps<TValues extends FieldValues> = {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  /** Explanation behind an info icon next to the label (DESIGN.md, helper-text rule). */
  hint?: string;
  description?: string;
  disabled?: boolean;
  variant?: 'plain' | 'bordered';
};

/** An on/off setting bound to a boolean form value, with its label and hint beside the switch. */
export const FormSwitchField = <TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  description,
  disabled,
  variant,
}: FormSwitchFieldProps<TValues>) => {
  const {
    field: { ref, onBlur, onChange, value, name: fieldName },
    fieldState,
  } = useController({ control, name });
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <Field
      orientation="horizontal"
      className={switchFieldVariants({ variant })}
      data-invalid={fieldState.invalid || undefined}
    >
      <FieldContent>
        <HintedLabel htmlFor={id} label={label} hint={hint} hintId={hintId} />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        <FormFieldError id={`${id}-error`} message={fieldState.error?.message} />
      </FieldContent>
      <Switch
        id={id}
        ref={ref}
        name={fieldName}
        checked={value === true}
        onCheckedChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        aria-describedby={describedBy(hintId, descriptionId)}
      />
    </Field>
  );
};
