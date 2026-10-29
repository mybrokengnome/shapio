import type { ApprovalSignoff } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/helpers/cn';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';

type SignoffsProps = {
  signoffs: readonly ApprovalSignoff[];
  /** The set's current round: older sign-offs say they came from an earlier one. */
  round: number;
};

/**
 * Every sign-off and request for changes, newest first: who, at which stage, when, and the note. One that no
 * longer counts (an earlier round, or the set changed since) says so and is dimmed.
 */
export const Signoffs = ({ signoffs, round }: SignoffsProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  if (signoffs.length === 0) {
    return null;
  }
  return (
    <ul aria-label={t('approval.signoffs')} className="divide-y rounded-lg border">
      {[...signoffs].reverse().map((signoff) => {
        const values = { name: actorLabel(signoff.by), stage: signoff.stageName ?? '' };
        const action =
          signoff.decision === 'approve'
            ? signoff.stageName
              ? t('approval.signedStage', values)
              : t('approval.signedOff', values)
            : signoff.stageName
              ? t('approval.changesRequestedStage', values)
              : t('approval.changesRequestedOff', values);
        return (
          <li
            key={`${signoff.round}-${signoff.stageId}-${signoff.at}-${signoff.by.id ?? ''}`}
            className={cn('space-y-0.5 px-3 py-2', !signoff.current && 'text-muted-foreground')}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{action}</span>
              <time dateTime={signoff.at} title={formatDateTime(signoff.at)} className="text-meta">
                {formatRelativeTime(signoff.at)}
              </time>
              {signoff.current ? null : (
                <Badge variant="outline">
                  {signoff.round < round ? t('approval.earlierRound') : t('approval.changedSince')}
                </Badge>
              )}
            </div>
            {signoff.note ? <p className="text-sm break-words">{signoff.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
};
