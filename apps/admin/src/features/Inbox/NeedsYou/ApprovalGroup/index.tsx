import { Link } from '@tanstack/react-router';
import { BadgeCheck } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/ErrorState';
import { IconTile } from '@/components/IconTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useActorLabel } from '@/features/Develop/Changes/hooks/useActorLabel';
import { formatRelativeTime } from '@/helpers/formatDate';
import type { AwaitingApprovalGroup } from '../../hooks/useAwaitingApprovalGroup';

type ApprovalGroupProps = { group: AwaitingApprovalGroup };

/**
 * "Awaiting your approval": each set this admin can sign off now, who asked and when, the stage it is at, the
 * note, and a link to review it (plan approval-workflows). Shown first: a person is waiting.
 */
export const ApprovalGroup = ({ group }: ApprovalGroupProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  const actorLabel = useActorLabel();
  const { query, sets } = group;
  if (query.isError) {
    return <ErrorState size="panel" error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (sets.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="py-1">
      <div className="flex items-center gap-3 px-5 pt-3 pb-1">
        <IconTile icon={BadgeCheck} size="sm" tone="warning" />
        <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t('inbox.awaitingApproval')}
        </h3>
        <Badge variant="secondary" className="tabular-nums">
          {group.hasMorePages ? `${group.count.toLocaleString()}+` : group.count.toLocaleString()}
        </Badge>
      </div>
      <ul className="divide-y">
        {sets.map((set) => (
          <li key={set.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-semibold">{set.title}</p>
              <p className="text-meta text-muted-foreground">
                {[
                  t('inbox.approvalMeta', {
                    name: actorLabel(set.approval.requestedBy),
                    at: formatRelativeTime(set.approval.requestedAt ?? set.updatedAt),
                  }),
                  set.approval.stage
                    ? t('changes.approval.stageProgress', {
                        stage: set.approval.stage.name,
                        signed: set.approval.stage.signed,
                        required: set.approval.stage.required,
                      })
                    : '',
                  set.approval.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/changes/$changeSetId" params={{ changeSetId: set.id }}>
                {t('inbox.reviewSet')}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      {group.canShowAll || group.hasMore ? (
        <div className="px-5 pb-2">
          <Button
            variant="ghost"
            size="sm"
            aria-describedby={headingId}
            disabled={group.loadingMore}
            onClick={group.canShowAll ? group.showAll : group.loadMore}
          >
            {group.loadingMore
              ? t('common.loading')
              : group.canShowAll
                ? t('inbox.showAllSets')
                : t('inbox.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
