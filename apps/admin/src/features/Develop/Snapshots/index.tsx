import { useNavigate, useSearch } from '@tanstack/react-router';
import { Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSnapshots } from '@/api/snapshots';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { TableCard } from '@/components/TableCard';
import { useCursorPager } from '@/features/Publishing/hooks/useCursorPager';
import { useDevelopPermissions } from '../Changes/hooks/useDevelopPermissions';
import { NoAccess } from '../Changes/NoAccess';
import { usePinnedBy } from './hooks/usePinnedBy';
import { Table } from './Table';

/** Snapshots: every publication snapshot (`?snapshot=N`), deployments-style, with compare, restore and pin. */
export const Snapshots = () => {
  const { t } = useTranslation();
  const { canManageChanges } = useDevelopPermissions();
  const { cursor } = useSearch({ from: '/app/snapshots' });
  const navigate = useNavigate({ from: '/snapshots' });
  const { pagerProps } = useCursorPager(cursor, (next) => void navigate({ search: { cursor: next } }));
  const snapshots = useSnapshots(cursor);
  const { canReadUsage, pinnedBy } = usePinnedBy();
  if (!canManageChanges) {
    return (
      <Page width="full">
        <PageHeader title={t('snapshots.title')} />
        <NoAccess />
      </Page>
    );
  }
  return (
    <Page width="full">
      <PageHeader
        title={t('snapshots.title')}
        meta={snapshots.data ? t('snapshots.current', { seq: snapshots.data.current }) : undefined}
      />
      <QueryView
        query={snapshots}
        loadingRows={6}
        isEmpty={(data) => data.items.length === 0 && cursor === undefined}
        empty={<EmptyState icon={Camera} title={t('snapshots.empty')} />}
      >
        {(data) => (
          <TableCard footer={<CursorPager {...pagerProps(data.nextCursor)} />}>
            <Table
              snapshots={data.items}
              current={data.current}
              pinnedBy={pinnedBy}
              showPins={canReadUsage}
            />
          </TableCard>
        )}
      </QueryView>
    </Page>
  );
};
