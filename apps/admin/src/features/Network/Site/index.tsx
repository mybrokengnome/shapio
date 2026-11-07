import { linkOptions, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSite } from '@/api/sites';
import { goToSite } from '@/app/currentSite';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNetworkPermission } from '../hooks/useNetworkPermission';
import { AppRoleBindings } from './AppRoleBindings';
import { DangerZone } from './DangerZone';
import { Details } from './Details';
import { Primary } from './Primary';

/**
 * Network → Sites → one site: its name and key, the app roles it grants, whether it is the primary site (and
 * making it primary), and deleting it (not while it is primary).
 */
export const Site = () => {
  const { t } = useTranslation();
  const { siteId } = useParams({ from: '/app/network/workspaces/$siteId' });
  const site = useSite(siteId);
  const canManage = useNetworkPermission('sites.manage');
  const canManageRoles = useNetworkPermission('roles.manage');
  return (
    <Page width="narrow">
      <QueryView query={site}>
        {(data) => (
          <>
            <PageHeader
              breadcrumb={[{ label: t('sites.title'), link: linkOptions({ to: '/network/workspaces' }) }]}
              title={data.name}
              badge={data.isPrimary ? <Badge variant="secondary">{t('sites.primary')}</Badge> : null}
              meta={data.key}
              actions={
                <Button variant="outline" onClick={() => goToSite(data.key)}>
                  {t('sites.open')}
                </Button>
              }
            />
            <Details key={data.id} site={data} canManage={canManage} />
            <AppRoleBindings siteId={data.id} canManage={canManageRoles} />
            <Primary site={data} canManage={canManage} />
            {canManage && !data.isPrimary ? <DangerZone site={data} /> : null}
          </>
        )}
      </QueryView>
    </Page>
  );
};
