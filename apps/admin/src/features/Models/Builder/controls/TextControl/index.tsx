import { HintedLabel } from '@/components/HintedLabel';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/helpers/cn';
import { IssueList } from '../IssueList';
import { controlIds, type ControlBaseProps } from '../types';

type TextControlProps = ControlBaseProps & {
  value: string | undefined;
  /** Receives `undefined` when the input is emptied and `emptyAsUndefined` is set. */
  onChange: (value: string | undefined) => void;
  emptyAsUndefined?: boolean;
  multiline?: boolean;
  monospace?: boolean;
  maxLength?: number;
};

export const TextControl = ({
  id,
  label,
  hint,
  description,
  issues = [],
  disabled,
  value,
  onChange,
  emptyAsUndefined = false,
  multiline = false,
  monospace = false,
  maxLength,
}: TextControlProps) => {
  const ids = controlIds(id, { hint, description, issues });
  const shared = {
    id,
    value: value ?? '',
    disabled,
    maxLength,
    'aria-invalid': issues.length > 0 || undefined,
    'aria-describedby': ids.describedBy,
    onChange: (event: { target: { value: string } }) =>
      onChange(emptyAsUndefined && event.target.value === '' ? undefined : event.target.value),
  };
  return (
    <Field data-invalid={issues.length > 0 || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={ids.hintId} />
      {multiline ? (
        <Textarea {...shared} rows={2} />
      ) : (
        <Input
          {...shared}
          autoComplete="off"
          spellCheck={!monospace}
          className={cn(monospace && 'font-mono')}
        />
      )}
      {description ? <FieldDescription id={ids.descriptionId}>{description}</FieldDescription> : null}
      <IssueList id={ids.errorId} issues={issues} />
    </Field>
  );
};
