import type { ChangeSet } from '@shapio/client';
import { BadgeCheck, MessageSquareMore, Undo2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { ineligibleMessageOf, type ApprovalState } from '../helpers/approvalState';
import { useApprovalWrites } from '../hooks/useApprovalWrites';
import { NotePopover, type NoteAction } from '../NotePopover';

type ActionsProps = { set: ChangeSet; state: ApprovalState };

/**
 * The approval steps this admin may take on the set (plan approval-workflows): ask for approval; review
 * (approve, or request changes with a note); send back only, when they may no longer approve at this stage;
 * a disabled Approve with the reason when they can't sign; and Clear.
 */
export const Actions = ({ set, state }: ActionsProps) => {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const writes = useApprovalWrites(set.id);
  const requestChanges: NoteAction = {
    key: 'requestChanges',
    label: t('changes.approval.requestChanges'),
    requiresNote: true,
    run: writes.requestChanges,
  };
  const blocked = state.approveBlockedBy ? ineligibleMessageOf(state.approveBlockedBy, set.approval) : null;
  const blockedText = blocked
    ? blocked.values
      ? t(blocked.key, {
          roles: new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(blocked.values.roles),
        })
      : t(blocked.key)
    : '';
  return (
    <>
      {state.canClear ? (
        <Button type="button" size="sm" variant="ghost" disabled={writes.clearing} onClick={writes.clear}>
          {t('changes.approval.clear')}
        </Button>
      ) : null}
      {state.canRequest ? (
        <NotePopover
          triggerLabel={t('changes.approval.request')}
          icon={MessageSquareMore}
          title={t('changes.approval.requestTitle')}
          noteLabel={t('changes.approval.noteOptional')}
          actions={[{ key: 'request', label: t('changes.approval.request'), run: writes.request }]}
        />
      ) : null}
      {state.canApprove ? (
        <NotePopover
          triggerLabel={t('changes.approval.review')}
          icon={BadgeCheck}
          title={t('changes.approval.reviewTitle')}
          noteLabel={t('changes.approval.note')}
          actions={[
            ...(state.canRequestChanges ? [requestChanges] : []),
            { key: 'approve', label: t('changes.approval.approve'), run: writes.approve },
          ]}
        />
      ) : null}
      {!state.canApprove && state.canRequestChanges ? (
        <NotePopover
          triggerLabel={t('changes.approval.requestChanges')}
          icon={Undo2}
          title={t('changes.approval.requestChangesTitle')}
          noteLabel={t('changes.approval.note')}
          actions={[requestChanges]}
        />
      ) : null}
      {blocked ? (
        <span className="inline-flex items-center gap-1">
          <Button type="button" variant="outline" disabled aria-describedby={hintId}>
            <BadgeCheck aria-hidden="true" />
            {t('changes.approval.approve')}
          </Button>
          <InfoHint about={t('changes.approval.approve')} id={hintId}>
            {blockedText}
          </InfoHint>
        </span>
      ) : null}
    </>
  );
};
