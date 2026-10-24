import { Link } from '@tanstack/react-router';
import { Plus, Shapes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useDefinitions } from '@/api/schema';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { INTERFACES_DOCS_URL } from '@/constants/interfaces';
import { useModelIndex } from '@/features/Models/hooks/useModelIndex';
import { useSchemaLock } from '@/features/Models/hooks/useSchemaLock';
import { List } from '@/features/Models/List';
import { LockNotice } from '@/features/Models/LockNotice';
import { ExternalLink } from '@/features/Publishing/ExternalLink';

/**
 * `/develop/interfaces`: contracts of fields that several types share, so a relation or a list can take any
 * of them (Develop → Interfaces, plan interfaces D11).
 */
export const Interfaces = () => {
  const { t } = useTranslation();
  const interfaces = useDefinitions('interface');
  const { index } = useModelIndex();
  const canCreate = useHasGlobalPermission('schema.create');
  const { locked, reason } = useSchemaLock();
  const createAction =
    canCreate && !locked ? (
      <Button asChild>
        <Link to="/develop/interfaces/new">
          <Plus aria-hidden="true" />
          {t('interfaces.new')}
        </Link>
      </Button>
    ) : null;
  return (
    <Page>
      <PageHeader title={t('interfaces.title')} actions={createAction} />
      {locked ? <LockNotice reason={reason} /> : null}
      <QueryView
        query={interfaces}
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            icon={Shapes}
            title={t('interfaces.empty')}
            description={t('interfaces.howItWorks')}
            action={
              <div className="flex flex-col items-center gap-3">
                {createAction}
                <span className="text-meta">
                  <ExternalLink href={INTERFACES_DOCS_URL}>{t('interfaces.docsLink')}</ExternalLink>
                </span>
              </div>
            }
          />
        }
      >
        {(data) => <List items={data} memberCount={(id) => index.implementedBy(id).length} />}
      </QueryView>
    </Page>
  );
};
