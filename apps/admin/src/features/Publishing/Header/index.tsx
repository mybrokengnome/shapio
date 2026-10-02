import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkTabs } from '@/components/LinkTabs';
import { PageHeader } from '@/components/PageHeader';
import { usePublishingPermissions } from '../hooks/usePublishingPermissions';
import { permittedSections } from '../sections';

type HeaderProps = {
  /** The current tab's actions (its "New …" button), primary last. */
  actions?: ReactNode;
};

/** The header of every Publishing list: "Publishing", the section tabs the admin may open, and actions. */
export const Header = ({ actions }: HeaderProps) => {
  const { t } = useTranslation();
  const { permissions } = usePublishingPermissions();
  return (
    <PageHeader
      title={t('nav.publishing')}
      actions={actions}
      tabs={
        <LinkTabs
          label={t('publishing.sections')}
          tabs={permittedSections(permissions).map((section) => ({
            to: section.to,
            label: t(section.labelKey),
          }))}
        />
      }
    />
  );
};
