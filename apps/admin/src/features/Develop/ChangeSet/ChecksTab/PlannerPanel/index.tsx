import type { ReviewSchemaItem } from '@shapio/client';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StepList } from '@/features/Models/Builder/ReviewSheet/StepList';
import { useSchemaItemDefinitions } from '../../hooks/useSchemaItemDefinitions';
import { IssueList } from '../../IssueList';

type PlannerPanelProps = { changeSetId: string; item: ReviewSchemaItem };

/** One schema item's planner result: entries affected, prerequisite checks and conversions, follow-ups. */
export const PlannerPanel = ({ changeSetId, item }: PlannerPanelProps) => {
  const { t } = useTranslation();
  const { before, after } = useSchemaItemDefinitions(changeSetId, item);
  const plan = item.plan;
  return (
    <Panel
      title={t('changes.review.plannerTitle', { name: after?.label ?? before?.label ?? item.apiKey })}
      titleAs="h3"
      description={t('changes.review.affected', { count: item.impact?.affectedHeads ?? 0 })}
    >
      <div className="space-y-4">
        {item.issues.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              <IssueList issues={item.issues} />
            </AlertDescription>
          </Alert>
        ) : null}
        {plan && plan.prerequisites.length > 0 ? (
          <section className="space-y-3" aria-label={t('models.plan.prerequisites')}>
            <div className="flex items-center gap-1">
              <h4 className="text-sm font-semibold">{t('models.plan.prerequisites')}</h4>
              <InfoHint about={t('models.plan.prerequisites')}>{t('models.plan.prerequisitesHint')}</InfoHint>
            </div>
            <StepList
              phase="before"
              steps={plan.prerequisites}
              impacts={item.impact?.steps}
              before={before}
              after={after}
            />
          </section>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
            {t('changes.review.noPrerequisites')}
          </p>
        )}
        {plan && plan.followUps.length > 0 ? (
          <section className="space-y-3" aria-label={t('models.plan.followUps')}>
            <h4 className="text-sm font-semibold">{t('models.plan.followUps')}</h4>
            <StepList phase="after" steps={plan.followUps} before={before} after={after} />
          </section>
        ) : null}
      </div>
    </Panel>
  );
};
