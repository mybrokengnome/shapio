import type { AuditEvent } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuditEvents } from '@/api/audit';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/UserAvatar';
import { auditTargetName } from '@/helpers/auditTargetName';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useAuditLabels } from '@/hooks/useAuditLabels';
import { NAMED_TARGET_TYPES, RECENT_ACTIVITY_LIMIT } from '../constants';
import { lowerFirst } from '../helpers/lowerFirst';

type RowProps = { event: AuditEvent };

/** "Ada Lovelace signed in", with the entry, model or user it touched beneath when it has a name. */
const Row = ({ event }: RowProps) => {
  const { t, i18n } = useTranslation();
  const { actionLabel, targetLabel } = useAuditLabels();
  const actor = event.actorName ?? event.actorEmail ?? t(`audit.actorTypes.${event.actorType}`);
  const action = actionLabel(event.action);
  const targetName =
    event.targetType && NAMED_TARGET_TYPES.has(event.targetType)
      ? auditTargetName(event.metadata)
      : undefined;
  const targetType = event.targetType ? targetLabel(event.targetType) : undefined;
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <UserAvatar name={actor} size="sm" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" title={event.action}>
          <span className="font-semibold">{actor}</span>
          {action ? (
            <span>{lowerFirst(action, i18n.language)}</span>
          ) : (
            <span className="font-mono text-xs">{event.action}</span>
          )}
          {event.outcome === 'failure' ? (
            <StatusChip tone="danger" size="sm" label={t('audit.failure')} />
          ) : null}
        </p>
        {targetName ? (
          <p className="truncate text-meta text-muted-foreground">
            {targetType ? t('home.activityTarget', { type: targetType, name: targetName }) : targetName}
          </p>
        ) : null}
      </div>
      <time
        dateTime={event.occurredAt}
        title={formatDateTime(event.occurredAt)}
        className="shrink-0 text-meta whitespace-nowrap text-muted-foreground"
      >
        {formatRelativeTime(event.occurredAt)}
      </time>
    </li>
  );
};

/** The last few audit events. Mounted only for admins who may read the audit log. */
export const Activity = () => {
  const { t } = useTranslation();
  const events = useAuditEvents({ limit: RECENT_ACTIVITY_LIMIT });
  return (
    <Panel
      title={t('home.activity')}
      flush
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings/audit-log">{t('home.viewAuditLog')}</Link>
        </Button>
      }
    >
      <QueryView
        query={events}
        loadingRows={4}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState size="panel" icon={ScrollText} title={t('home.noActivity')} />}
      >
        {(data) => (
          <ul className="divide-y">
            {data.items.map((event) => (
              <Row key={event.id} event={event} />
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
};
