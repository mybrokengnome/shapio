import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { USAGE_DAYS } from '@/api/usage';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Panel } from '@/components/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { usePrincipalLabel } from '../../Changes/hooks/usePrincipalLabel';
import { useReaders } from '../hooks/useReaders';
import { FieldList } from './FieldList';

/** Who reads what: each delivery reader, the fields it read, how often, and the snapshot it pins. */
export const ReadersTable = () => {
  const { t } = useTranslation();
  const principalLabel = usePrincipalLabel();
  const readers = useReaders(true);
  const body = () => {
    if (readers.isPending) {
      return <LoadingState rows={3} />;
    }
    if (readers.error) {
      return <ErrorState error={readers.error} onRetry={() => void readers.refetch()} />;
    }
    if (readers.principals.length === 0) {
      return (
        <EmptyState icon={Users} size="panel" title={t('develop.live.noReaders', { count: USAGE_DAYS })} />
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('changes.consumers.reader')}</TableHead>
            <TableHead>{t('develop.live.fields')}</TableHead>
            <TableHead className="text-right">{t('develop.live.requests')}</TableHead>
            <TableHead>{t('changes.consumers.lastRead')}</TableHead>
            <TableHead>{t('develop.live.pinned')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {readers.principals.map((principal) => (
            <TableRow key={principal.principalKey}>
              <TableCell className="font-semibold whitespace-nowrap">
                {principalLabel(principal.principalKey, principal.tokenName)}
              </TableCell>
              <TableCell className="max-w-96">
                <FieldList fields={principal.fields} modelKeyOf={readers.modelKeyOf} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{principal.requests.toLocaleString()}</TableCell>
              <TableCell className="whitespace-nowrap" title={formatDateTime(principal.lastReadAt)}>
                {formatRelativeTime(principal.lastReadAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {principal.lastSnapshot === null ? (
                  t('develop.live.followsLive')
                ) : (
                  <Link
                    to="/snapshots/$seq"
                    params={{ seq: String(principal.lastSnapshot) }}
                    className="text-link underline-offset-4 hover:underline"
                  >
                    {t('snapshots.version', { seq: principal.lastSnapshot })}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };
  return (
    <Panel
      title={t('develop.live.readersTitle')}
      description={t('develop.live.servedReads', { count: readers.servedReads, days: USAGE_DAYS })}
      flush
    >
      {readers.tracking ? null : (
        <p className="border-b px-5 py-2.5 text-meta text-muted-foreground">
          {t('develop.live.notTracking')}
        </p>
      )}
      {body()}
    </Panel>
  );
};
