import { FieldLabel } from '@/components/ui/field';
import { cn } from '@/helpers/cn';
import { InfoHint } from '../InfoHint';

type HintedLabelProps = {
  htmlFor: string;
  label: string;
  /** Optional explanation behind an info icon (see InfoHint). */
  hint?: string;
  /** Id of the hidden hint text; put it in the control's `aria-describedby`. */
  hintId?: string;
  className?: string;
};

/** A field label with an optional info-icon hint beside it (the label stays the click target). */
export const HintedLabel = ({ htmlFor, label, hint, hintId, className }: HintedLabelProps) => (
  <div className={cn('flex items-center gap-1', className)}>
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
    {hint ? (
      <InfoHint about={label} id={hintId}>
        {hint}
      </InfoHint>
    ) : null}
  </div>
);
