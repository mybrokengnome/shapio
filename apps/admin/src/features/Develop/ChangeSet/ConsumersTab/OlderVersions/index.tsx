import type { ChangeSetReview } from '@shapio/client';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Panel } from '@/components/Panel';
import { StatusChip } from '@/components/StatusChip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  historyTruncatedIn,
  olderReaderRows,
  PAST_LOSS_KEYS,
  READER_OUTCOME_DISPLAY,
  type OlderReaderRow,
} from '@/features/Models/helpers/olderClients';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { usePrincipalLabel } from '../../../Changes/hooks/usePrincipalLabel';

type OlderVersionsProps = { review: ChangeSetReview };

/**
 * Readers that name an older schema version: each with the version it sends and what it sees once the set
 * ships (for the breaking fields it reads). Readers the admin may not name, and other workspaces', are counts.
 */
export const OlderVersions = ({ review }: OlderVersionsProps) => {
  const { t } = useTranslation();
  const principalLabel = usePrincipalLabel();
  const { multiSite } = useSchemaScopeAccess();
  const rows = useMemo(
    () => olderReaderRows(review.olderClients, review.consumers),
    [review.olderClients, review.consumers],
  );
  const readerOf = (row: OlderReaderRow) => {
    if (row.reader) {
      return principalLabel(row.reader.principalKey, row.reader.label);
    }
    return row.otherSites
      ? t('changes.consumers.olderVersions.otherSites', { count: row.count })
      : t('changes.consumers.readers', { count: row.count });
  };
  const pastLossOf = ({ pastLoss }: OlderReaderRow) => {
    if (!pastLoss) {
      return null;
    }
    const keys = PAST_LOSS_KEYS[pastLoss.effect];
    return pastLoss.since === null ? t(keys.undated) : t(keys.dated, { version: pastLoss.since });
  };
  return (
    <Panel
      title={t('changes.consumers.olderVersions.title')}
      titleAs="h3"
      flush
      description={
        historyTruncatedIn(review.olderClients)
          ? t('changes.consumers.olderVersions.historyTruncated')
          : review.olderClients?.truncated
            ? t('changes.consumers.olderVersions.truncated', { count: review.olderClients.versions.length })
            : t('changes.consumers.olderVersions.description')
      }
      actions={
        <InfoHint about={t('changes.consumers.olderVersions.title')}>
          {t('changes.consumers.olderVersions.hint')}
        </InfoHint>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('changes.consumers.reader')}</TableHead>
            {multiSite ? <TableHead>{t('changes.consumers.site')}</TableHead> : null}
            <TableHead className="text-right">{t('changes.consumers.olderVersions.schemaVersion')}</TableHead>
            <TableHead>{t('changes.consumers.olderVersions.outcome')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const display = READER_OUTCOME_DISPLAY[row.outcome];
            return (
              <TableRow key={row.key} data-older-reader={row.reader?.principalKey ?? row.key}>
                <TableCell className={row.reader ? 'font-semibold' : 'text-muted-foreground'}>
                  <span className="flex items-center gap-2">
                    {readerOf(row)}
                    {row.reader?.pinned ? (
                      <StatusChip
                        tone="muted"
                        size="sm"
                        label={t('changes.consumers.olderVersions.pinned')}
                      />
                    ) : null}
                  </span>
                </TableCell>
                {multiSite ? (
                  <TableCell className="font-mono text-meta text-muted-foreground">
                    {row.reader?.site.key ?? ''}
                  </TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{row.schemaVersion}</TableCell>
                <TableCell className="whitespace-normal">
                  <StatusChip tone={display.tone} size="sm" label={t(display.labelKey)} />
                  {row.pastLoss ? (
                    <span data-past-loss className="mt-1 block text-meta text-muted-foreground">
                      {pastLossOf(row)}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
};
