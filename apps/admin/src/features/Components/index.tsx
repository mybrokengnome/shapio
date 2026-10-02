import { Link } from '@tanstack/react-router';
import { Blocks, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useDefinitions } from '@/api/schema';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useSchemaLock } from '@/features/Models/hooks/useSchemaLock';
import { List } from '@/features/Models/List';
import { LockNotice } from '@/features/Models/LockNotice';

/** `/develop/components`: reusable field groups that content types embed (Develop → Components). */
export const Components = () => {
  const { t } = useTranslation();
  const components = useDefinitions('component');
  const canCreate = useHasGlobalPermission('schema.create');
  const { locked, reason } = useSchemaLock();
  const createAction =
    canCreate && !locked ? (
      <Button asChild>
        <Link to="/develop/components/new">
          <Plus aria-hidden="true" />
          {t('contentTypes.newComponentTitle')}
        </Link>
      </Button>
    ) : null;
  return (
    <Page>
      <PageHeader title={t('shell.nav.components')} actions={createAction} />
      {locked ? <LockNotice reason={reason} /> : null}
      <QueryView
        query={components}
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            icon={Blocks}
            title={t('contentTypes.noComponents')}
            description={t('models.emptyDescription')}
            action={createAction}
          />
        }
      >
        {(data) => <List items={data} />}
      </QueryView>
    </Page>
  );
};
