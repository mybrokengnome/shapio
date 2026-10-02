import { ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuditEvents } from '@/api/audit';
import { AUDIT_PAGE_SIZE } from '@/app/searchSchemas';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { TableCard } from '@/components/TableCard';
import { Filters } from './Filters';
import { useAuditLogSearch } from './hooks/useAuditLogSearch';
import { Table } from './Table';

export const AuditLog = () => {
  const { t } = useTranslation();
  const { search, goFirst, goPrevious, goNext, setFilters } = useAuditLogSearch();
  const events = useAuditEvents({
    cursor: search.cursor,
    limit: AUDIT_PAGE_SIZE,
    action: search.action,
    actorType: search.actorType,
  });
  const nextCursor = events.data?.nextCursor;
  return (
    <Page width="full">
      <PageHeader title={t('audit.title')} />
      <TableCard
        toolbar={
          <Filters
            key={`${search.action ?? ''}|${search.actorType ?? ''}`}
            action={search.action}
            actorType={search.actorType}
            onChange={setFilters}
          />
        }
        footer={
          <CursorPager
            onFirst={goFirst}
            onPrevious={goPrevious}
            onNext={nextCursor ? () => goNext(nextCursor) : undefined}
          />
        }
      >
        <QueryView
          query={events}
          loadingRows={8}
          isEmpty={(data) => data.items.length === 0 && search.cursor === undefined}
          empty={<EmptyState size="panel" icon={ScrollText} title={t('audit.empty')} />}
        >
          {(data) => <Table events={data.items} />}
        </QueryView>
      </TableCard>
    </Page>
  );
};
