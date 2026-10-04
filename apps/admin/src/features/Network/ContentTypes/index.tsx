import { Link } from '@tanstack/react-router';
import { Boxes, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSharedDefinitions } from '@/api/schema';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useSchemaLock } from '@/features/Models/hooks/useSchemaLock';
import { List } from '@/features/Models/List';
import { LockNotice } from '@/features/Models/LockNotice';

/**
 * Network → Content types: the content types and components shared with all sites (each site has them,
 * with its own content). Rows open the builder; New creates a shared one. The network route guard and the
 * nav item need `schema.create` on every site; the server enforces it either way.
 */
export const ContentTypes = () => {
  const { t } = useTranslation();
  const shared = useSharedDefinitions();
  const { locked, reason } = useSchemaLock();
  const createAction = locked ? null : (
    <Button asChild>
      <Link to="/network/content-types/new">
        <Plus aria-hidden="true" />
        {t('contentTypes.network.create')}
      </Link>
    </Button>
  );
  return (
    <Page>
      <PageHeader
        title={t('contentTypes.network.title')}
        meta={shared.data ? t('contentTypes.network.count', { count: shared.data.length }) : undefined}
        actions={createAction}
      />
      {locked ? <LockNotice reason={reason} /> : null}
      <QueryView
        query={shared}
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            icon={Boxes}
            title={t('contentTypes.network.empty')}
            description={t('contentTypes.network.emptyDescription')}
            action={createAction}
          />
        }
      >
        {(data) => <List items={data} showKind markShared={false} />}
      </QueryView>
    </Page>
  );
};
