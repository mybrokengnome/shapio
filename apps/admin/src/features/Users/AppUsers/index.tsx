import { UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppRoleNames } from '@/api/appRoles';
import { useAppUsers } from '@/api/appUsers';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { TableCard } from '@/components/TableCard';
import { Tabs } from '../Tabs';
import { APP_USERS_PAGE_SIZE } from './constants';
import { useAppUserActions } from './hooks/useAppUserActions';
import { useAppUsersSearch } from './hooks/useAppUsersSearch';
import { Search } from './Search';
import { Table } from './Table';

/** Users → App users: the end users of the sites and apps built on Shapio. */
export const AppUsers = () => {
  const { t } = useTranslation();
  const { search, setQuery, goFirst, goPrevious, goNext } = useAppUsersSearch();
  const users = useAppUsers({ search: search.q, cursor: search.cursor, limit: APP_USERS_PAGE_SIZE });
  const { names: roleNames } = useAppRoleNames();
  const actions = useAppUserActions();
  const nextCursor = users.data?.nextCursor;
  return (
    <Page>
      <PageHeader title={t('appUsers.title')} tabs={<Tabs />} />
      <TableCard
        toolbar={<Search query={search.q} onQueryChange={setQuery} />}
        footer={
          <CursorPager
            onFirst={goFirst}
            onPrevious={goPrevious}
            onNext={nextCursor ? () => goNext(nextCursor) : undefined}
          />
        }
      >
        <QueryView
          query={users}
          loadingRows={8}
          isEmpty={(data) => data.items.length === 0 && search.cursor === undefined}
          empty={
            <EmptyState
              size="panel"
              icon={UsersRound}
              title={search.q ? t('appUsers.noMatches') : t('appUsers.empty')}
              description={search.q ? undefined : t('appUsers.emptyDescription')}
            />
          }
        >
          {(data) => (
            <Table
              users={data.items}
              roleNames={roleNames}
              onResendConfirmation={actions.resendConfirmation}
              onConfirmed={actions.run}
            />
          )}
        </QueryView>
      </TableCard>
    </Page>
  );
};
