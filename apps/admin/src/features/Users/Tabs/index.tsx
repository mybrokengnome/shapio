import { useTranslation } from 'react-i18next';
import { LinkTabs } from '@/components/LinkTabs';

/** Admins (who sign in to this admin) and app users (who sign in to the sites built on it). */
export const Tabs = () => {
  const { t } = useTranslation();
  return (
    <LinkTabs
      label={t('users.sections')}
      tabs={[
        { to: '/users', label: t('users.tabAdmins') },
        { to: '/users/app', label: t('users.tabAppUsers') },
      ]}
    />
  );
};
