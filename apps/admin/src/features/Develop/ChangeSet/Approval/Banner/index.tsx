import type { ChangeSet } from '@shapio/client';
import { BadgeCheck, MessageSquareMore, ShieldAlert, Undo2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';
import { useDevelopPermissions } from '../../../Changes/hooks/useDevelopPermissions';
import { approvalStateOf } from '../helpers/approvalState';
import { useApprovalWrites } from '../hooks/useApprovalWrites';

type Tone = 'info' | 'success' | 'warning' | 'destructive';

type ApprovalBannerProps = {
  set: ChangeSet;
  /** The site requires an approved set before it ships or is scheduled. */
  requireApproval: boolean;
};

const EDITABLE: ReadonlySet<string> = new Set(['open', 'failed']);

/**
 * Where the set's approval stands (plan approval): who asked or decided, when, and the note; an outdated
 * approval says so. When the site requires approval and the set can't ship yet, it says why Ship and Schedule
 * are disabled. Clearing the approval is here, for those who prepare sets.
 */
export const ApprovalBanner = ({ set, requireApproval }: ApprovalBannerProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const state = approvalStateOf(set, useDevelopPermissions());
  const writes = useApprovalWrites(set.id);
  const { approval } = set;
  const blocked = requireApproval && EDITABLE.has(set.status) && !state.current;
  if (approval.status === 'none' && !blocked) {
    return null;
  }
  const decided = {
    name: actorLabel(approval.approvedBy),
    at: formatRelativeTime(approval.approvedAt ?? ''),
  };
  const requested = {
    name: actorLabel(approval.requestedBy),
    at: formatRelativeTime(approval.requestedAt ?? ''),
  };
  const display: { tone: Tone; icon: LucideIcon; title: string } | null =
    approval.status === 'requested'
      ? { tone: 'info', icon: MessageSquareMore, title: t('changes.approval.requestedBy', requested) }
      : approval.status === 'changes_requested'
        ? { tone: 'destructive', icon: Undo2, title: t('changes.approval.changesRequestedBy', decided) }
        : approval.status === 'approved' && approval.outdated
          ? { tone: 'warning', icon: ShieldAlert, title: t('changes.approval.outdatedTitle', decided) }
          : approval.status === 'approved'
            ? { tone: 'success', icon: BadgeCheck, title: t('changes.approval.approvedBy', decided) }
            : null;
  const Icon = display?.icon ?? ShieldAlert;
  return (
    <Alert
      variant={display?.tone ?? 'warning'}
      role="status"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <AlertTitle className="line-clamp-none">
            {display?.title ?? t('changes.approval.requiredTitle')}
          </AlertTitle>
          {approval.note ? (
            <AlertDescription className="break-words">{approval.note}</AlertDescription>
          ) : null}
          {blocked ? <AlertDescription>{t('changes.approval.requiredDescription')}</AlertDescription> : null}
        </div>
      </div>
      {state.canClear ? (
        <Button type="button" size="sm" variant="ghost" disabled={writes.clearing} onClick={writes.clear}>
          {t('changes.approval.clear')}
        </Button>
      ) : null}
    </Alert>
  );
};
