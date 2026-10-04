import { Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Why a shared definition can't be changed here: one line, above the builder. */
export const SharedNotice = () => {
  const { t } = useTranslation();
  return (
    <Alert>
      <Globe2 aria-hidden="true" />
      <AlertDescription>{t('models.scope.readOnly')}</AlertDescription>
    </Alert>
  );
};
