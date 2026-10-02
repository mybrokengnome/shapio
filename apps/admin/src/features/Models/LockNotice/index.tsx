import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type LockNoticeProps = { reason: string | null };

/** Why schema editing is disabled on this instance, and where changes come from instead. */
export const LockNotice = ({ reason }: LockNoticeProps) => {
  const { t } = useTranslation();
  return (
    <Alert variant="warning">
      <Lock aria-hidden="true" />
      <AlertTitle>{t('models.lock.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('models.lock.description')}</p>
        {reason ? <p>{t('models.lock.reason', { reason })}</p> : null}
      </AlertDescription>
    </Alert>
  );
};
