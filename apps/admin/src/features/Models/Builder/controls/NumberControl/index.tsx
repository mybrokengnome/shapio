import { useState } from 'react';
import { HintedLabel } from '@/components/HintedLabel';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { IssueList } from '../IssueList';
import { controlIds, type ControlBaseProps } from '../types';

type NumberControlProps = ControlBaseProps & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  integer?: boolean;
  min?: number;
  max?: number;
};

const parse = (text: string, integer: boolean): number | undefined => {
  if (text.trim() === '') {
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return integer ? Math.trunc(parsed) : parsed;
};

/** A number input whose empty state means "not set" (`undefined`). */
export const NumberControl = ({
  id,
  label,
  hint,
  description,
  issues = [],
  disabled,
  value,
  onChange,
  integer = false,
  min,
  max,
}: NumberControlProps) => {
  // Keep the typed text (e.g. "1." or "-") while it is not yet a number.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [shownValue, setShownValue] = useState(value);
  // The value changed from outside (reload, discard): show it, unless the text already means it.
  if (value !== shownValue) {
    setShownValue(value);
    if (parse(text, integer) !== value) {
      setText(value === undefined ? '' : String(value));
    }
  }
  const ids = controlIds(id, { hint, description, issues });
  return (
    <Field data-invalid={issues.length > 0 || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={ids.hintId} />
      <Input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        step={integer ? 1 : 'any'}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-invalid={issues.length > 0 || undefined}
        aria-describedby={ids.describedBy}
        onChange={(event) => {
          const next = parse(event.target.value, integer);
          setText(event.target.value);
          setShownValue(next);
          onChange(next);
        }}
      />
      {description ? <FieldDescription id={ids.descriptionId}>{description}</FieldDescription> : null}
      <IssueList id={ids.errorId} issues={issues} />
    </Field>
  );
};
