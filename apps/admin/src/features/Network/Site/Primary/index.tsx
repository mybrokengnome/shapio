import type { Site } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMakePrimarySite } from '@/api/sites';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { useCurrentPrimarySite } from '../hooks/useCurrentPrimarySite';

type PrimaryProps = { site: Site; canManage: boolean };

/**
 * Whether requests that name no site read this site. The primary site says another must be made primary
 * before it can be deleted; any other site can be made primary (`sites.manage`), right away.
 */
export const Primary = ({ site, canManage }: PrimaryProps) => {
  const { t } = useTranslation();
  const makePrimary = useMakePrimarySite();
  const { primary } = useCurrentPrimarySite();
  const current = primary && primary.id !== site.id ? primary : undefined;
  const confirm = async () => {
    await makePrimary.mutateAsync(site);
    toast.success(t('sites.primarySite.made', { name: site.name }));
  };
  const description = site.isPrimary
    ? t('sites.primarySite.isPrimary')
    : current
      ? t('sites.primarySite.notPrimary', { primary: current.name })
      : t('sites.primarySite.notPrimaryUnknown');
  const canMake = canManage && !site.isPrimary;
  return (
    // Without a button the body is empty: it keeps only the bottom padding that matches the header's top.
    <Panel
      title={t('sites.primarySite.title')}
      description={description}
      bodyClassName={canMake ? undefined : 'pb-1'}
    >
      {canMake ? (
        <InlineConfirm
          tone="default"
          title={t('sites.primarySite.confirmTitle', { name: site.name })}
          description={
            current
              ? t('sites.primarySite.confirmConsequence', { name: site.name, primary: current.name })
              : t('sites.primarySite.confirmConsequenceUnknown', { name: site.name })
          }
          confirmLabel={t('sites.primarySite.makePrimary')}
          onConfirm={confirm}
          trigger={<Button variant="outline">{t('sites.primarySite.makePrimary')}</Button>}
        />
      ) : null}
    </Panel>
  );
};
