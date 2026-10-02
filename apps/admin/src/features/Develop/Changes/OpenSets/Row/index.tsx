import type { ChangeSetSummary } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { CHANGE_SET_STATUS_DISPLAY } from '../../constants';
import { useActorLabel } from '../../hooks/useActorLabel';

type RowProps = { set: ChangeSetSummary; connectionName: string | undefined };

/** One set: title (→ review), status, items, author, and when it ships or last changed. */
export const Row = ({ set, connectionName }: RowProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const status = CHANGE_SET_STATUS_DISPLAY[set.status];
  const when = set.scheduledFor ?? set.updatedAt;
  return (
    <TableRow>
      <TableCell className="max-w-80">
        <RowTitle asChild className="block truncate">
          <Link to="/changes/$changeSetId" params={{ changeSetId: set.id }}>
            {set.title}
          </Link>
        </RowTitle>
        {set.description ? (
          <span className="block truncate text-meta text-muted-foreground">{set.description}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <StatusChip tone={status.tone} label={t(status.labelKey)} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {t('changes.itemCount', { count: set.entryItemCount + set.schemaItemCount })}
      </TableCell>
      <TableCell className="whitespace-nowrap">{actorLabel(set.createdBy)}</TableCell>
      <TableCell className="whitespace-nowrap" title={formatDateTime(when)}>
        {set.scheduledFor
          ? t('changes.scheduledFor', { at: formatDateTime(set.scheduledFor) })
          : formatRelativeTime(when)}
        {connectionName ? (
          <span className="block text-meta text-muted-foreground">
            {t('changes.deploysTo', { name: connectionName })}
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
};
