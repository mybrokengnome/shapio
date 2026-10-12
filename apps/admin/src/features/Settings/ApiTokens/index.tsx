import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { NoAccess } from '@/components/NoAccess';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Manage } from './Manage';

/** Settings → API tokens. Reached by URL without `tokens.manage`: the reason, and no New token. */
export const ApiTokens = () => {
  const { t } = useTranslation();
  const canManage = useHasGlobalPermission('tokens.manage');
  if (canManage) {
    return <Manage />;
  }
  return (
    <Page width="full">
      <PageHeader title={t('apiTokens.title')} />
      <NoAccess />
    </Page>
  );
};
