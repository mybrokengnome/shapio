import type { PlanStep, PlanStepImpact } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { AlertTriangle, CircleDashed, Clock } from 'lucide-react';
import { cn } from '@/helpers/cn';
import { describeStep, describeStepImpact, stepsToShow } from '../../../helpers/describeStep';

type StepListProps = {
  steps: readonly PlanStep[];
  /** Impact per step, in the same order (prerequisites only). */
  impacts?: readonly PlanStepImpact[];
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  /** Prerequisites run before activation (clock, or a warning when entries would fail); follow-ups after. */
  phase: 'before' | 'after';
};

const STATUS_CLASSES = {
  waiting: 'text-muted-foreground',
  failing: 'border-warning/40 bg-warning-muted text-warning',
  later: 'text-muted-foreground',
} as const;

const STATUS_ICONS = { waiting: Clock, failing: AlertTriangle, later: CircleDashed } as const;

/**
 * Steps as a vertical timeline: a status icon per step, joined by a line. A value check on a field whose
 * values are dropped is not listed (see `stepsToShow`).
 */
export const StepList = ({ steps, impacts, before, after, phase }: StepListProps) => {
  const shown = stepsToShow(steps, impacts);
  return (
    <ol className="space-y-0">
      {shown.map(({ step, impact }, index) => {
        const status = phase === 'after' ? 'later' : impact?.invalidHeads ? 'failing' : 'waiting';
        const Icon = STATUS_ICONS[status];
        const detail = describeStepImpact(step, impact);
        return (
          <li key={`${step.kind}-${index}`} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border bg-card',
                  STATUS_CLASSES[status],
                )}
              >
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              {index < shown.length - 1 ? (
                <span aria-hidden="true" className="my-1 w-px flex-1 bg-border" />
              ) : null}
            </span>
            <div className="min-w-0 pt-0.5 pb-4 text-sm">
              {describeStep(step, before, after, impact)}
              {detail ? <span className="block text-meta text-muted-foreground">{detail}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
