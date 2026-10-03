import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { goToSite } from '@/app/currentSite';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';

/**
 * The page for a site the admin holds no role on (sites plan §H): nothing of the site can be read, so it says
 * so instead of failing request by request, and offers the admin's own sites (also in the switcher).
 */
export const NoSiteAccess = () => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const elsewhere = me?.sites[0];
  return (
    <Page width="narrow">
      <PageHeader title={me?.site.name ?? ''} meta={me?.site.key} />
      <EmptyState
        icon={Lock}
        title={t('sites.noAccess.title')}
        description={elsewhere ? t('sites.noAccess.description') : t('sites.noAccess.noSites')}
        action={
          elsewhere ? (
            <Button onClick={() => goToSite(elsewhere.key)}>
              {t('sites.openNamed', { name: elsewhere.name })}
            </Button>
          ) : undefined
        }
      />
    </Page>
  );
};
