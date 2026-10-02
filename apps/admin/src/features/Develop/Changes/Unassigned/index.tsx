import { Link } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUnassignedEntries } from '@/api/changeSets';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { AddToPopover } from '../AddToPopover';

const UNASSIGNED_STATUS = {
  draft: { labelKey: 'changes.unassigned.statuses.draft', tone: 'neutral' },
  modified: { labelKey: 'changes.unassigned.statuses.modified', tone: 'warning' },
} as const;

/** Drafts not yet in a change set, each with "Add to…". */
export const Unassigned = () => {
  const { t } = useTranslation();
  const entries = useUnassignedEntries();
  return (
    <Panel title={t('changes.unassigned.title')} flush>
      <QueryView
        query={entries}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState icon={Inbox} size="panel" title={t('changes.unassigned.empty')} />}
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('changes.fields.entry')}</TableHead>
                <TableHead>{t('changes.fields.model')}</TableHead>
                <TableHead>{t('changes.fields.locale')}</TableHead>
                <TableHead>{t('changes.fields.status')}</TableHead>
                <TableHead>{t('changes.fields.updated')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((entry) => {
                const status = UNASSIGNED_STATUS[entry.status];
                const title = entry.title ?? entry.entryId;
                return (
                  <TableRow key={`${entry.entryId}:${entry.locale}`}>
                    <TableCell className="max-w-72">
                      {entry.modelKey ? (
                        <RowTitle asChild className="block truncate">
                          <Link
                            to="/content/$modelKey/$entryId"
                            params={{ modelKey: entry.modelKey, entryId: entry.entryId }}
                            search={{ locale: entry.locale }}
                          >
                            {title}
                          </Link>
                        </RowTitle>
                      ) : (
                        <RowTitle className="block truncate">{title}</RowTitle>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.modelKey ?? t('common.unknown')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.locale}</TableCell>
                    <TableCell>
                      <StatusChip tone={status.tone} label={t(status.labelKey)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap" title={formatDateTime(entry.updatedAt)}>
                      {formatRelativeTime(entry.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <AddToPopover entry={entry} label={t('changes.addToLabel', { title })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </QueryView>
    </Panel>
  );
};
