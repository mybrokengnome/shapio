import type { ChangeSetApproval } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { APPROVAL_DISPLAY } from '../constants';

type ApprovalChipProps = { approval: ChangeSetApproval; size?: 'default' | 'sm' };

/** A set's approval (plan approval): requested, approved, changes requested or outdated; nothing when none. */
export const ApprovalChip = ({ approval, size }: ApprovalChipProps) => {
  const { t } = useTranslation();
  if (approval.status === 'none') {
    return null;
  }
  const display =
    APPROVAL_DISPLAY[approval.status === 'approved' && approval.outdated ? 'outdated' : approval.status];
  return <StatusChip tone={display.tone} label={t(display.labelKey)} size={size} />;
};
