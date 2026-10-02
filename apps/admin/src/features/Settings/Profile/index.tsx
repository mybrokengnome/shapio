import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { Details } from './Details';
import { Password } from './Password';

export const Profile = () => {
  const { t } = useTranslation();
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const onDetailsDirtyChange = useCallback((dirty: boolean) => setDetailsDirty(dirty), []);
  const onPasswordDirtyChange = useCallback((dirty: boolean) => setPasswordDirty(dirty), []);
  return (
    <Page width="full">
      <PageHeader title={t('profile.title')} />
      <Details onDirtyChange={onDetailsDirtyChange} />
      <Password onDirtyChange={onPasswordDirtyChange} />
      <UnsavedChangesGuard when={detailsDirty || passwordDirty} />
    </Page>
  );
};
