import type { ModelDefinition } from '@shapio/schema';
import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AssistError } from '@/components/AssistError';
import { InfoHint } from '@/components/InfoHint';
import { StatusChip } from '@/components/StatusChip';
import { TextLink } from '@/components/TextLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { entryLink } from '@/features/Inbox/helpers/entryLink';
import { describeIssue } from '@/fields/helpers/issues';
import { FILL_OUTCOME_TONES, NOT_ADDED_KEYS } from '../../constants';
import type { FillGroup } from '../../helpers/fillGroups';
import type { FieldFill } from '../../hooks/useFieldFill';
import { Field } from '../Field';

type GroupProps = {
  group: FillGroup;
  fill: FieldFill;
  model: ModelDefinition | undefined;
};

/**
 * One entry locale's proposed values: the entry (a link to it), each field with its value and Reject, and
 * one Accept that saves the fields not rejected together into the entry's draft. The outcome replaces the
 * button once it is final (in the change set, saved as a draft only, or filled meanwhile).
 */
export const Group = ({ group, fill, model }: GroupProps) => {
  const { t } = useTranslation();
  const outcome = fill.outcomeOf(group);
  const pending = fill.isPending(group);
  const final =
    outcome?.kind === 'saved' || outcome?.kind === 'filledMeanwhile' || outcome?.kind === 'unsavedWork';
  const allRejected = group.proposals.every((proposal) => fill.isRejected(proposal.key));
  const title = group.entryTitle ?? t('content.untitled');
  const firstPath = group.proposals[0]?.fieldPath;
  const link = entryLink(
    group.modelKey,
    group.entryId,
    model?.kind === 'singleton' ? 'singleton' : 'collection',
    {
      locale: group.locale,
      ...(outcome?.kind === 'invalid'
        ? { path: outcome.issues[0]?.path }
        : firstPath
          ? { path: firstPath }
          : {}),
    },
  );
  return (
    <li className="space-y-3 py-4 first:pt-0">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <TextLink {...link} className="min-w-0 truncate text-sm font-semibold">
            {title}
          </TextLink>
          <Badge variant="outline" className="uppercase">
            {group.locale}
          </Badge>
          {outcome?.kind === 'saved' ? (
            outcome.changeSet.added ? (
              <StatusChip size="sm" tone={FILL_OUTCOME_TONES.added} label={t('assist.fill.inChangeSet')} />
            ) : (
              <span className="inline-flex items-center gap-1">
                <StatusChip
                  size="sm"
                  tone={FILL_OUTCOME_TONES.draftOnly}
                  label={t('assist.fill.savedAsDraft')}
                />
                <InfoHint about={t('assist.fill.savedAsDraft')}>
                  {t(NOT_ADDED_KEYS[outcome.changeSet.reason])}
                </InfoHint>
              </span>
            )
          ) : outcome?.kind === 'filledMeanwhile' ? (
            <StatusChip
              size="sm"
              tone={FILL_OUTCOME_TONES.filledMeanwhile}
              label={t('assist.fill.filledMeanwhile')}
            />
          ) : outcome?.kind === 'unsavedWork' ? (
            <span className="inline-flex items-center gap-1">
              <StatusChip
                size="sm"
                tone={FILL_OUTCOME_TONES.unsavedWork}
                label={t('assist.fill.unsavedWork')}
              />
              <InfoHint about={t('assist.fill.unsavedWork')}>{t('assist.fill.unsavedWorkHint')}</InfoHint>
            </span>
          ) : outcome?.kind === 'invalid' ? (
            <StatusChip size="sm" tone={FILL_OUTCOME_TONES.invalid} label={t('assist.fill.notSaved')} />
          ) : allRejected ? (
            <StatusChip size="sm" tone={FILL_OUTCOME_TONES.rejected} label={t('assist.fixes.rejected')} />
          ) : null}
        </div>
        {model ? <p className="text-meta text-muted-foreground">{model.label}</p> : null}
      </div>
      <div className="space-y-4">
        {group.proposals.map((proposal) => (
          <Field key={proposal.key} proposal={proposal} fill={fill} locked={final || pending} />
        ))}
      </div>
      {outcome?.kind === 'invalid' ? (
        <div role="alert" className="space-y-0.5 text-meta text-destructive">
          <p>{t('assist.fill.invalid')}</p>
          <ul className="list-disc pl-5">
            {outcome.issues.map((issue) => (
              <li key={`${issue.path}-${issue.code}`}>
                {t('assist.fill.issue', { path: issue.path, problem: describeIssue(issue) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {outcome?.kind === 'failed' ? <AssistError error={outcome.error} /> : null}
      {final ? null : (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={pending || allRejected || fill.hasEmptyValue(group)}
            aria-busy={pending || undefined}
            aria-label={pending ? undefined : t('assist.fill.acceptFor', { entry: title })}
            onClick={() => fill.accept(group)}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            {pending ? t('common.saving') : t('assist.fixes.accept')}
          </Button>
        </div>
      )}
    </li>
  );
};
