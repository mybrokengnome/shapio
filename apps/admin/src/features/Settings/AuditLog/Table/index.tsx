import type { AuditEvent } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserAvatar } from '@/components/UserAvatar';
import { auditTargetName } from '@/helpers/auditTargetName';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useAuditLabels } from '@/hooks/useAuditLabels';

type TableProps = { events: AuditEvent[] };

/** `admin_role:1f2e…`: the raw reference, kept in a title for support and log searches. */
const targetReference = (event: AuditEvent) =>
  event.targetType ? `${event.targetType}:${event.targetId ?? ''}` : undefined;

export const Table = ({ events }: TableProps) => {
  const { t } = useTranslation();
  const { actionLabel, targetLabel } = useAuditLabels();
  return (
    <TableRoot>
      <TableHeader>
        <TableRow>
          <TableHead>{t('audit.actor')}</TableHead>
          <TableHead>{t('audit.action')}</TableHead>
          <TableHead>{t('audit.target')}</TableHead>
          <TableHead>{t('audit.outcome')}</TableHead>
          <TableHead>{t('audit.ipAddress')}</TableHead>
          <TableHead>{t('audit.when')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => {
          const actorType = t(`audit.actorTypes.${event.actorType}`);
          const name = event.actorName ?? event.actorEmail ?? actorType;
          const detail =
            event.actorName && event.actorEmail
              ? event.actorEmail
              : event.actorName || event.actorEmail
                ? actorType
                : (event.actorId ?? undefined);
          const action = actionLabel(event.action);
          const reference = targetReference(event);
          const targetName = auditTargetName(event.metadata);
          return (
            <TableRow key={event.id}>
              <TableCell>
                <span className="flex items-center gap-2.5">
                  <UserAvatar name={name} size="sm" />
                  <span className="min-w-0">
                    <span className="block max-w-48 truncate text-sm font-semibold">{name}</span>
                    {detail ? (
                      <span className="block max-w-48 truncate text-xs text-muted-foreground" title={detail}>
                        {detail}
                      </span>
                    ) : null}
                  </span>
                </span>
              </TableCell>
              <TableCell title={event.action}>
                {action ? (
                  <Badge variant="secondary">{action}</Badge>
                ) : (
                  <Badge variant="secondary" className="font-mono">
                    {event.action}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="max-w-64" title={reference}>
                {event.targetType ? (
                  <>
                    <span className="block truncate text-sm">
                      {targetLabel(event.targetType) ?? (
                        <span className="font-mono text-xs">{event.targetType}</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {targetName ?? <span className="font-mono">{event.targetId}</span>}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                )}
              </TableCell>
              <TableCell>
                <StatusChip
                  tone={event.outcome === 'success' ? 'success' : 'danger'}
                  label={event.outcome === 'success' ? t('audit.success') : t('audit.failure')}
                />
              </TableCell>
              <TableCell className="font-mono text-xs">{event.ip ?? t('common.unknown')}</TableCell>
              <TableCell className="whitespace-nowrap" title={formatDateTime(event.occurredAt)}>
                {formatRelativeTime(event.occurredAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </TableRoot>
  );
};
