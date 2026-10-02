import { HintedLabel } from '@/components/HintedLabel';
import { Field, FieldContent, FieldDescription } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/helpers/cn';
import { IssueList } from '../IssueList';
import { controlIds, type ControlBaseProps } from '../types';

type SwitchControlProps = ControlBaseProps & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * `row`: label on the left, switch on the right (settings lists). `compact`: switch first, then the
   * label, for the two-column grid of field options.
   */
  layout?: 'row' | 'compact';
};

export const SwitchControl = ({
  id,
  label,
  hint,
  description,
  issues = [],
  disabled,
  checked,
  onChange,
  layout = 'row',
}: SwitchControlProps) => {
  const ids = controlIds(id, { hint, description, issues });
  const control = (
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-invalid={issues.length > 0 || undefined}
      aria-describedby={ids.describedBy}
      className={cn(layout === 'compact' && 'mt-0.5 self-start')}
    />
  );
  return (
    <Field orientation="horizontal" data-invalid={issues.length > 0 || undefined}>
      {layout === 'compact' ? control : null}
      <FieldContent>
        <HintedLabel htmlFor={id} label={label} hint={hint} hintId={ids.hintId} />
        {description ? <FieldDescription id={ids.descriptionId}>{description}</FieldDescription> : null}
        <IssueList id={ids.errorId} issues={issues} />
      </FieldContent>
      {layout === 'row' ? control : null}
    </Field>
  );
};
