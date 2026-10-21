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
import { hasFailingCheck } from '../../helpers/describeStep';
import { bucketOfPlan, type PlanBucket } from '../../helpers/planBuckets';
import { BucketChip } from '../BucketChip';
import { ChangeList } from './ChangeList';
import { useReviewInChangeSet } from './hooks/useReviewInChangeSet';
import { StepList } from './StepList';

type ReviewSheetProps = {
  preview: PlanPreview | undefined;
  /** The active definition and the draft, as stored: what a change set receives. */
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  /**
   * Both resolved over their parents, so sentences can name inherited fields (a re-parent adds and removes
   * them). Default: `before` and `after`.
   */
  resolvedBefore?: SchemaDefinition | null;
  resolvedAfter?: SchemaDefinition | null;
  /** A model's name by ID: parents in "Move under Products", kinds a change also applies to. */
  definitionName?: (id: string) => string | undefined;
  /** For an interface: the types that implement it in this site's view (used when the plan names none). */
  memberIds?: readonly string[];
  applying: boolean;
  error: unknown;
  onApply: (acknowledgement: Acknowledgement) => void;
  onClose: () => void;
};

const isModelKind = (kind: string) => kind === 'collection' || kind === 'singleton';

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
  resolvedBefore = before,
  resolvedAfter = after,
  definitionName,
  memberIds: knownMemberIds = [],
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
  // A check the preview already knows fails would only fail the ship; a change set can still be reviewed.
  const failingCheck = previewShown ? hasFailingCheck(previewShown.impact.steps) : false;
  // A model's change reaches every kind below it (the plan's affected models are its family); an
  // interface's reaches its members.
  const reachedIds = plan ? plan.affectedModelIds.filter((modelId) => modelId !== plan.definitionId) : [];
  const kindIds = plan && isModelKind(plan.kind) ? reachedIds : [];
  const kindNames = kindIds.flatMap((modelId) => definitionName?.(modelId) ?? []);
  const memberIds = plan?.kind === 'interface' ? (reachedIds.length > 0 ? reachedIds : knownMemberIds) : [];
  const memberNames = memberIds.flatMap((modelId) => definitionName?.(modelId) ?? []);
  const canApply =
    !failingCheck &&
    (!needsBreaking || acknowledgedBreaking) &&
    (!needsDestructive || acknowledgedDestructive);
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
                {kindIds.length > 0 ? (
                  <span className="text-meta text-muted-foreground">
                    {kindNames.length === kindIds.length
                      ? t('models.inheritance.appliesToKindsNamed', {
                          count: kindIds.length,
                          names: kindNames.join(', '),
                        })
                      : t('models.inheritance.appliesToKinds', { count: kindIds.length })}
                  </span>
                ) : null}
                {memberIds.length > 0 ? (
                  <span className="text-meta text-muted-foreground">
                    {memberNames.length === memberIds.length
                      ? t('models.implements.appliesToMembersNamed', {
                          count: memberIds.length,
                          names: memberNames.join(', '),
                        })
                      : t('models.implements.appliesToMembers', { count: memberIds.length })}
                  </span>
                ) : null}
              </div>
              <section className="space-y-3" aria-labelledby="plan-changes">
                <h3 id="plan-changes" className="text-sm font-semibold">
                  {t('models.plan.changes', { count: plan.changes.length })}
                </h3>
                <ChangeList
                  changes={plan.changes}
                  before={resolvedBefore}
                  after={resolvedAfter}
                  definitionName={definitionName}
                  memberCount={plan.kind === 'interface' ? memberIds.length : undefined}
                />
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
                    before={resolvedBefore}
                    after={resolvedAfter}
                    definitionName={definitionName}
                  />
                </section>
              ) : null}
              {plan.followUps.length > 0 ? (
                <section className="space-y-3" aria-labelledby="plan-follow-ups">
                  <h3 id="plan-follow-ups" className="text-sm font-semibold">
                    {t('models.plan.followUps')}
                  </h3>
                  <StepList
                    phase="after"
                    steps={plan.followUps}
                    before={resolvedBefore}
                    after={resolvedAfter}
                    definitionName={definitionName}
                  />
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
              {failingCheck ? (
                <p id="plan-blocked" className="text-meta text-warning">
                  {t('models.plan.blockedByCheck')}
                </p>
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
                aria-describedby={failingCheck ? 'plan-blocked' : undefined}
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
