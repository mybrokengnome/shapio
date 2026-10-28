import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useSiteChangeSets } from '@/api/siteChangeSets';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { SettingsForm } from './SettingsForm';

/** Settings → Change sets: the current site's approval workflow (`site.settings`; read-only without it). */
export const ChangeSets = () => {
  const { t } = useTranslation();
  const settings = useSiteChangeSets();
  const canEdit = useHasGlobalPermission('site.settings');
  return (
    <Page width="narrow">
      <PageHeader title={t('settings.changeSets')} />
      <QueryView query={settings} loadingRows={3}>
        {(data) => <SettingsForm key={data.version} settings={data} canEdit={canEdit} />}
      </QueryView>
    </Page>
  );
};
