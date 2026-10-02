import type { Acknowledgement, PlanPreview } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { GitPullRequest, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { InfoHint } from '@/components/InfoHint';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { bucketOfPlan, type PlanBucket } from '../../helpers/planBuckets';
import { BucketChip } from '../BucketChip';
import { ChangeList } from './ChangeList';
import { useReviewInChangeSet } from './hooks/useReviewInChangeSet';
import { StepList } from './StepList';

type ReviewSheetProps = {
  preview: PlanPreview | undefined;
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  applying: boolean;
  error: unknown;
  onApply: (acknowledgement: Acknowledgement) => void;
  onClose: () => void;
};

const SUMMARY_KEYS = {
  breaking: 'models.plan.summary.breaking',
  prerequisites: 'models.plan.summary.prerequisites',
  live: 'models.plan.summary.live',
  metadata: 'models.plan.summary.metadata',
} as const satisfies Record<PlanBucket, string>;

/**
 * The plan preview (brief §5 step 5), in a wide sheet so the builder stays in view: every change classified,
 * the entries affected, the prerequisite jobs that run before activation, and explicit acknowledgement for
 * breaking or destructive changes. From here the draft either ships now (the primary action) or goes into
 * a change set to be reviewed and shipped with other work ("Review in a change set"). It can't be closed
 * while either is in progress.
 */
export const ReviewSheet = ({
  preview,
  before,
  after,
  applying,
  error,
  onApply,
  onClose,
}: ReviewSheetProps) => {
  const { t } = useTranslation();
  const [acknowledgedBreaking, setAcknowledgedBreaking] = useState(false);
  const [acknowledgedDestructive, setAcknowledgedDestructive] = useState(false);
  const [previewShown, setPreviewShown] = useState(preview);
  const { reviewInChangeSet, saving, saveError, resetSave } = useReviewInChangeSet();
  const busy = applying || saving;
  // A new preview starts with nothing acknowledged. The last one stays rendered while the sheet closes.
  if (preview !== undefined && preview !== previewShown) {
    setPreviewShown(preview);
    setAcknowledgedBreaking(false);
    setAcknowledgedDestructive(false);
    resetSave();
  }
  const plan = previewShown?.plan;
  const summary = plan?.summary;
  const bucket = summary ? bucketOfPlan(summary) : 'metadata';
  const needsBreaking = summary?.breaking ?? false;
  const needsDestructive = summary?.destructive ?? false;
  const canApply = (!needsBreaking || acknowledgedBreaking) && (!needsDestructive || acknowledgedDestructive);
  return (
    <Sheet open={preview !== undefined} onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent size="lg">
        <SheetHeader className="pr-14">
          <SheetTitle>{t('models.plan.title', { label: after?.label ?? '' })}</SheetTitle>
          <SheetDescription>{t(SUMMARY_KEYS[bucket])}</SheetDescription>
        </SheetHeader>
        {plan && previewShown ? (
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              onApply({
                ...(needsBreaking ? { acknowledgeBreaking: true } : {}),
                ...(needsDestructive ? { acknowledgeDestructive: true } : {}),
              });
            }}
          >
            <SheetBody className="space-y-6 pt-1">
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
                <BucketChip bucket={bucket} />
                <span className="text-meta text-muted-foreground">
                  {t('models.plan.affected', { count: previewShown.impact.affectedHeads })}
                </span>
              </div>
              <section className="space-y-3" aria-labelledby="plan-changes">
                <h3 id="plan-changes" className="text-sm font-semibold">
                  {t('models.plan.changes', { count: plan.changes.length })}
                </h3>
                <ChangeList changes={plan.changes} before={before} after={after} />
              </section>
              {plan.prerequisites.length > 0 ? (
                <section className="space-y-3" aria-labelledby="plan-prerequisites">
                  <div className="flex items-center gap-1">
                    <h3 id="plan-prerequisites" className="text-sm font-semibold">
                      {t('models.plan.prerequisites')}
                    </h3>
                    <InfoHint about={t('models.plan.prerequisites')}>
                      {t('models.plan.prerequisitesHint')}
                    </InfoHint>
                  </div>
                  <StepList
                    phase="before"
                    steps={plan.prerequisites}
                    impacts={previewShown.impact.steps}
                    before={before}
                    after={after}
                  />
                </section>
              ) : null}
              {plan.followUps.length > 0 ? (
                <section className="space-y-3" aria-labelledby="plan-follow-ups">
                  <h3 id="plan-follow-ups" className="text-sm font-semibold">
                    {t('models.plan.followUps')}
                  </h3>
                  <StepList phase="after" steps={plan.followUps} before={before} after={after} />
                </section>
              ) : null}
              {needsBreaking || needsDestructive ? (
                <fieldset className="space-y-3 rounded-lg border border-warning/40 bg-warning-muted/40 p-4">
                  <legend className="px-1 text-sm font-semibold text-warning">
                    {t('models.plan.acknowledge')}
                  </legend>
                  {needsBreaking ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        id="plan-ack-breaking"
                        checked={acknowledgedBreaking}
                        onCheckedChange={(checked) => setAcknowledgedBreaking(checked === true)}
                      />
                      <FieldLabel htmlFor="plan-ack-breaking" className="font-normal">
                        {t('models.plan.acknowledgeBreaking')}
                      </FieldLabel>
                    </Field>
                  ) : null}
                  {needsDestructive ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        id="plan-ack-destructive"
                        checked={acknowledgedDestructive}
                        onCheckedChange={(checked) => setAcknowledgedDestructive(checked === true)}
                      />
                      <FieldLabel htmlFor="plan-ack-destructive" className="font-normal">
                        {t('models.plan.acknowledgeDestructive')}
                      </FieldLabel>
                    </Field>
                  ) : null}
                </fieldset>
              ) : null}
              <FormError error={error ?? saveError} />
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !after}
                aria-busy={saving || undefined}
                onClick={() => after && void reviewInChangeSet(previewShown, after)}
              >
                {saving ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <GitPullRequest aria-hidden="true" />
                )}
                {saving ? t('common.saving') : t('changes.reviewInChangeSet')}
              </Button>
              <SubmitButton
                pending={applying}
                pendingLabel={t('models.plan.applying')}
                disabled={!canApply || saving}
              >
                {t('models.plan.apply')}
              </SubmitButton>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
