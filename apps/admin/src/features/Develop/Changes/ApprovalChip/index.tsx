import type { ChangeSetApprovalSummary } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { APPROVAL_DISPLAY } from '../constants';

type ApprovalChipProps = { approval: ChangeSetApprovalSummary; size?: 'default' | 'sm' };

/**
 * A set's approval (plan approval-workflows): in review with its stage ("In review · Legal 1/2"), approved,
 * changes requested, or outdated (changed after a sign-off or after approval); nothing when none.
 */
export const ApprovalChip = ({ approval, size }: ApprovalChipProps) => {
  const { t } = useTranslation();
  if (approval.status === 'none') {
    return null;
  }
  const outdated = approval.outdated && approval.status !== 'changes_requested';
  const display = APPROVAL_DISPLAY[outdated ? 'outdated' : approval.status];
  const label =
    !outdated && approval.status === 'requested' && approval.stage
      ? t('changes.approval.inReviewAt', {
          stage: approval.stage.name,
          signed: approval.stage.signed,
          required: approval.stage.required,
        })
      : t(display.labelKey);
  return <StatusChip tone={display.tone} label={label} size={size} />;
};
