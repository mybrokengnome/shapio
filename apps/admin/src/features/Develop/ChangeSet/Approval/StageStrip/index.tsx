import type { ApprovalWorkflow, ChangeSetApproval } from '@shapio/client';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';

type StageStripProps = {
  /** The frozen workflow while a review runs, or the site's workflow before one starts. */
  workflow: Pick<ApprovalWorkflow, 'stages'>;
  approval: Pick<ChangeSetApproval, 'status' | 'stage'>;
};

type StagePhase = 'done' | 'current' | 'pending';

const phaseOf = (index: number, approval: StageStripProps['approval']): StagePhase => {
  if (approval.status === 'approved') {
    return 'done';
  }
  if (approval.status !== 'requested' || !approval.stage) {
    return 'pending';
  }
  return index < approval.stage.index ? 'done' : index === approval.stage.index ? 'current' : 'pending';
};

/**
 * The workflow's stages in order, and where the review stands: "1 Editorial ✓ · 2 Legal 1/2 · 3 Publisher".
 * The current stage is marked for assistive technology (`aria-current="step"`).
 */
export const StageStrip = ({ workflow, approval }: StageStripProps) => {
  const { t } = useTranslation();
  return (
    <ol aria-label={t('approval.stages')} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {workflow.stages.map((stage, index) => {
        const phase = phaseOf(index, approval);
        return (
          <li
            key={stage.id}
            aria-current={phase === 'current' ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5',
              phase === 'pending' ? 'text-muted-foreground' : 'text-foreground',
              phase === 'current' && 'font-semibold',
            )}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            ) : null}
            <span className="tabular-nums">{index + 1}</span>
            <span>{stage.name}</span>
            {phase === 'done' ? (
              <>
                <Check aria-hidden="true" className="size-4 text-success" />
                <span className="sr-only">{t('approval.stageDone')}</span>
              </>
            ) : null}
            {phase === 'current' && approval.stage ? (
              <span className="tabular-nums">
                <span aria-hidden="true">
                  {t('approval.stageCount', {
                    signed: approval.stage.signed,
                    required: approval.stage.required,
                  })}
                </span>
                <span className="sr-only">
                  {t('approval.stageCountLong', {
                    signed: approval.stage.signed,
                    required: approval.stage.required,
                  })}
                </span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};
