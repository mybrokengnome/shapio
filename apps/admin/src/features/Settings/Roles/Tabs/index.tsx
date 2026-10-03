import { useTranslation } from 'react-i18next';
import { LinkTabs } from '@/components/LinkTabs';

/** Admin and token roles, and app roles (for the end users of the sites built on Shapio). */
export const Tabs = () => {
  const { t } = useTranslation();
  return (
    <LinkTabs
      label={t('roles.sections')}
      tabs={[
        { to: '/network/roles', label: t('roles.tabAdmin') },
        { to: '/network/roles/app', label: t('roles.tabApp') },
      ]}
    />
  );
};
