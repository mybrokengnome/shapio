import type { ChangeSetReview } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { RULE_TITLE_KEYS } from '@/features/Inbox/constants';
import { HealthChip } from '../../Changes/HealthChip';
import { useSetHealthFindings } from '../hooks/useSetHealthFindings';
import type { ShipFlow } from '../hooks/useShipFlow';
import { IssueList } from '../IssueList';
import { PlannerPanel } from './PlannerPanel';

const NOT_RESTORABLE_KEYS = {
  entry_deleted: 'changes.review.notRestorable.entry_deleted',
  model_missing: 'changes.review.notRestorable.model_missing',
  publishing_disabled: 'changes.review.notRestorable.publishing_disabled',
  localization_changed: 'changes.review.notRestorable.localization_changed',
  locale_missing: 'changes.review.notRestorable.locale_missing',
  invalid: 'changes.review.notRestorable.invalid',
  unique_conflict: 'changes.review.notRestorable.unique_conflict',
} as const;

type ChecksTabProps = { review: ChangeSetReview; flow: ShipFlow };

/**
 * What must hold before the set ships: blocking problems, the planner's results per schema item, entries
 * that fail validation, entries a restore can't bring back, content-health findings, and the
 * acknowledgement breaking or destructive changes need.
 */
export const ChecksTab = ({ review, flow }: ChecksTabProps) => {
  const { t } = useTranslation();
  const { findings } = useSetHealthFindings(review.entries);
  const invalidEntries = review.entries.filter((entry) => entry.issues.length > 0);
  return (
    <div className="space-y-4">
      {review.checks.blocking.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('changes.review.blockingTitle')}</AlertTitle>
          <AlertDescription>
            <IssueList issues={review.checks.blocking} />
          </AlertDescription>
        </Alert>
      ) : null}
      {review.checks.warnings.length > 0 ? (
        <Alert variant="warning">
          <Info aria-hidden="true" />
          <AlertTitle>{t('changes.review.warningsTitle')}</AlertTitle>
          <AlertDescription>
            <IssueList issues={review.checks.warnings} />
          </AlertDescription>
        </Alert>
      ) : null}
      {review.schema.map((item) => (
        <PlannerPanel key={item.itemId} changeSetId={review.changeSet.id} item={item} />
      ))}
      <Panel title={t('changes.review.validationTitle')} titleAs="h3">
        {invalidEntries.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
            {t('changes.review.allEntriesValid', { count: review.entries.length })}
          </p>
        ) : (
          <ul className="space-y-3">
            {invalidEntries.map((entry) => (
              <li key={entry.itemId} className="space-y-1 text-sm">
                {entry.modelKey ? (
                  <Link
                    to="/content/$modelKey/$entryId"
                    params={{ modelKey: entry.modelKey, entryId: entry.entryId }}
                    search={{ locale: entry.locale }}
                    className="font-semibold text-link underline-offset-4 hover:underline"
                  >
                    {entry.title ?? entry.entryId}
                  </Link>
                ) : (
                  <span className="font-semibold">{entry.title ?? entry.entryId}</span>
                )}
                <div className="text-destructive">
                  <IssueList issues={entry.issues} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {review.notRestorable.length > 0 ? (
        <Panel title={t('changes.review.notRestorableTitle')} titleAs="h3">
          <ul className="space-y-2 text-sm">
            {review.notRestorable.map((entry) => (
              <li key={`${entry.entryId}:${entry.locale}`}>
                <span className="font-mono text-xs">
                  {entry.modelKey ?? t('common.unknown')} · {entry.entryId} · {entry.locale}
                </span>
                <span className="block text-muted-foreground">
                  {t(NOT_RESTORABLE_KEYS[entry.reason])}
                  {entry.detail ? ` (${entry.detail})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel title={t('changes.review.healthTitle')} titleAs="h3">
        {findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
            {t('changes.review.noHealthFindings')}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {findings.map((finding) => (
              <li key={finding.id} className="flex flex-wrap items-center gap-2">
                <HealthChip severity={finding.severity} />
                <span className="font-semibold">{finding.entryTitle ?? finding.entryId}</span>
                <span className="text-muted-foreground">{t(RULE_TITLE_KEYS[finding.rule])}</span>
                {finding.locale === '*' ? null : (
                  <span className="font-mono text-xs text-muted-foreground">{finding.locale}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {flow.needsBreaking || flow.needsDestructive ? (
        <fieldset className="space-y-3 rounded-lg border border-warning/40 bg-warning-muted/40 p-4">
          <legend className="px-1 text-sm font-semibold text-warning">{t('models.plan.acknowledge')}</legend>
          {flow.needsBreaking ? (
            <Field orientation="horizontal">
              <Checkbox
                id="change-set-ack-breaking"
                checked={flow.acknowledgedBreaking}
                onCheckedChange={(checked) => flow.setAcknowledgedBreaking(checked === true)}
              />
              <FieldLabel htmlFor="change-set-ack-breaking" className="font-normal">
                {t('models.plan.acknowledgeBreaking')}
              </FieldLabel>
            </Field>
          ) : null}
          {flow.needsDestructive ? (
            <Field orientation="horizontal">
              <Checkbox
                id="change-set-ack-destructive"
                checked={flow.acknowledgedDestructive}
                onCheckedChange={(checked) => flow.setAcknowledgedDestructive(checked === true)}
              />
              <FieldLabel htmlFor="change-set-ack-destructive" className="font-normal">
                {t('models.plan.acknowledgeDestructive')}
              </FieldLabel>
            </Field>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
};
