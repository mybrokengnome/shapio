import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';

type NoAccessProps = { size?: 'panel' | 'page' };

/** Shown instead of a developer page or section the admin's roles don't grant. */
export const NoAccess = ({ size }: NoAccessProps) => {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Lock}
      size={size}
      title={t('develop.noAccess')}
      description={t('develop.noAccessDescription')}
    />
  );
};
