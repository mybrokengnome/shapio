import type { ChangeSet } from '@shapio/client';
import { BadgeCheck, MessageSquareMore, ShieldAlert, Undo2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';

type Tone = 'info' | 'success' | 'warning' | 'destructive';

type ApprovalBannerProps = {
  set: ChangeSet;
  /** The site requires approval and this set can't ship yet: say why Ship and Schedule are off. */
  blocked: boolean;
};

/**
 * Where the set's approval stands (plan approval-workflows): who asked or decided, when, and the note. An
 * outdated review or approval says to ask again. When the site requires approval and the set can't ship yet,
 * it says why Ship and Schedule are disabled.
 */
export const ApprovalBanner = ({ set, blocked }: ApprovalBannerProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const { approval } = set;
  if (approval.status === 'none' && !blocked) {
    return null;
  }
  const sentBack = approval.signoffs.findLast((signoff) => signoff.decision === 'request_changes');
  const decided = (by: ChangeSet['approval']['approvedBy'], at: string | null) => ({
    name: actorLabel(by),
    at: formatRelativeTime(at ?? ''),
  });
  const requested = decided(approval.requestedBy, approval.requestedAt);
  const approved = decided(approval.approvedBy, approval.approvedAt);
  const display: { tone: Tone; icon: LucideIcon; title: string } | null =
    approval.status === 'requested' && approval.outdated
      ? { tone: 'warning', icon: ShieldAlert, title: t('changes.approval.outdatedReviewTitle') }
      : approval.status === 'requested'
        ? { tone: 'info', icon: MessageSquareMore, title: t('changes.approval.requestedBy', requested) }
        : approval.status === 'changes_requested'
          ? {
              tone: 'destructive',
              icon: Undo2,
              title: t(
                'changes.approval.changesRequestedBy',
                decided(sentBack?.by ?? null, sentBack?.at ?? null),
              ),
            }
          : approval.status === 'approved' && approval.outdated
            ? { tone: 'warning', icon: ShieldAlert, title: t('changes.approval.outdatedTitle', approved) }
            : approval.status === 'approved'
              ? { tone: 'success', icon: BadgeCheck, title: t('changes.approval.approvedBy', approved) }
              : null;
  const Icon = display?.icon ?? ShieldAlert;
  return (
    <Alert variant={display?.tone ?? 'warning'} role="status">
      <Icon aria-hidden="true" />
      <AlertTitle className="line-clamp-none">
        {display?.title ?? t('changes.approval.requiredTitle')}
      </AlertTitle>
      {approval.note && approval.status !== 'approved' ? (
        <AlertDescription className="break-words">{approval.note}</AlertDescription>
      ) : null}
      {blocked ? <AlertDescription>{t('changes.approval.requiredDescription')}</AlertDescription> : null}
    </Alert>
  );
};
