import type { SnapshotChangeKind, SnapshotChangesPage } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { FileStack } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCard } from '@/components/TableCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const CHANGE_DISPLAY = {
  published: { labelKey: 'snapshots.changes.published', tone: 'success' },
  updated: { labelKey: 'snapshots.changes.updated', tone: 'warning' },
  unpublished: { labelKey: 'snapshots.changes.unpublished', tone: 'muted' },
} as const satisfies Record<SnapshotChangeKind, { labelKey: string; tone: 'success' | 'warning' | 'muted' }>;

type ChangeListProps = { page: SnapshotChangesPage };

/** Entries whose live content differs between two snapshots, with what happened per locale. */
export const ChangeList = ({ page }: ChangeListProps) => {
  const { t } = useTranslation();
  const { schemaVersions } = page;
  const schemaMoved = schemaVersions.from !== schemaVersions.to;
  return (
    <TableCard
      toolbar={
        <p className="text-meta text-muted-foreground">
          {t(page.nextCursor ? 'snapshots.diffSummaryMore' : 'snapshots.diffSummary', {
            from: page.from,
            to: page.to,
            count: page.items.length,
          })}
          {schemaMoved
            ? ` · ${t('snapshots.schemaMoved', { from: schemaVersions.from ?? '?', to: schemaVersions.to ?? '?' })}`
            : ''}
        </p>
      }
    >
      {page.items.length === 0 ? (
        <EmptyState icon={FileStack} size="panel" title={t('snapshots.noChanges')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('changes.fields.entry')}</TableHead>
              <TableHead>{t('changes.fields.model')}</TableHead>
              <TableHead>{t('snapshots.fields.locales')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="max-w-72">
                  <RowTitle asChild className="block truncate font-mono text-xs">
                    <Link
                      to="/content/$modelKey/$entryId"
                      params={{ modelKey: entry.modelKey, entryId: entry.id }}
                    >
                      {entry.id}
                    </Link>
                  </RowTitle>
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.modelKey}</TableCell>
                <TableCell>
                  <ul className="flex flex-wrap gap-1.5">
                    {entry.locales.map((locale) => {
                      const display = CHANGE_DISPLAY[locale.change];
                      return (
                        <li key={locale.locale}>
                          <StatusChip
                            tone={display.tone}
                            size="sm"
                            label={t('snapshots.localeChange', {
                              locale: locale.locale,
                              change: t(display.labelKey),
                            })}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
};
