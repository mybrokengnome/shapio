import type { ChangeSet } from '@shapio/client';
import { BadgeCheck, MessageSquareMore } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDevelopPermissions } from '../../Changes/hooks/useDevelopPermissions';
import { approvalStateOf } from './helpers/approvalState';
import { useApprovalWrites } from './hooks/useApprovalWrites';
import { NotePopover, type NoteAction } from './NotePopover';

type ApprovalActionsProps = { set: ChangeSet };

/**
 * The approval steps in the set's header (plan approval): "Request approval…" for those who prepare sets,
 * "Review…" (approve, or request changes with a note) for approvers. Each opens a note popover.
 */
export const ApprovalActions = ({ set }: ApprovalActionsProps) => {
  const { t } = useTranslation();
  const permissions = useDevelopPermissions();
  const state = approvalStateOf(set, permissions);
  const writes = useApprovalWrites(set.id);
  const reviewActions: NoteAction[] = [
    ...(state.canRequestChanges
      ? [
          {
            key: 'requestChanges',
            label: t('changes.approval.requestChanges'),
            requiresNote: true,
            run: writes.requestChanges,
          },
        ]
      : []),
    ...(state.canApprove
      ? [{ key: 'approve', label: t('changes.approval.approve'), run: writes.approve }]
      : []),
  ];
  return (
    <>
      {state.canRequest ? (
        <NotePopover
          triggerLabel={t('changes.approval.request')}
          icon={MessageSquareMore}
          title={t('changes.approval.requestTitle')}
          noteLabel={t('changes.approval.noteOptional')}
          actions={[{ key: 'request', label: t('changes.approval.request'), run: writes.request }]}
        />
      ) : null}
      {reviewActions.length > 0 ? (
        <NotePopover
          triggerLabel={t('changes.approval.review')}
          icon={BadgeCheck}
          title={t('changes.approval.reviewTitle')}
          noteLabel={t('changes.approval.note')}
          actions={reviewActions}
        />
      ) : null}
    </>
  );
};
