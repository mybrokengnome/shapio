import type { Site } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { Globe2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSites } from '@/api/sites';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useNetworkPermission } from '../hooks/useNetworkPermission';
import { CreateSheet } from './CreateSheet';
import { Table } from './Table';

/** Network → Sites: every site on this instance; one login and one schema, separate content. */
export const Sites = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sites = useSites();
  const canManage = useNetworkPermission('sites.manage');
  const [creating, setCreating] = useState(false);
  const onCreated = (site: Site) => {
    setCreating(false);
    toast.success(t('sites.created', { name: site.name }));
    void navigate({ to: '/network/sites/$siteId', params: { siteId: site.id } });
  };
  return (
    <Page>
      <PageHeader
        title={t('sites.title')}
        meta={sites.data ? t('sites.count', { count: sites.data.length }) : undefined}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('sites.create')}
            </Button>
          ) : null
        }
      />
      <QueryView
        query={sites}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={Globe2} title={t('sites.empty')} />}
      >
        {(data) => <Table sites={data} />}
      </QueryView>
      {canManage ? <CreateSheet open={creating} onOpenChange={setCreating} onCreated={onCreated} /> : null}
    </Page>
  );
};
