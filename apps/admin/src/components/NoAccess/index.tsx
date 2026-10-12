import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';

type NoAccessProps = { size?: 'panel' | 'page' };

/** Shown instead of a page, form or section the admin's roles don't grant (reached by URL, bookmark or ⌘K). */
export const NoAccess = ({ size }: NoAccessProps) => {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Lock}
      size={size}
      title={t('common.noAccess')}
      description={t('common.noAccessDescription')}
    />
  );
};
