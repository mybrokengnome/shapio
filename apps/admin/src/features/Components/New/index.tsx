import { linkOptions } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Form } from '@/features/Content/New/Form';

const KINDS = ['component'] as const;

/** `/develop/components/new`: a reusable component (Develop → Components). */
export const New = () => {
  const { t } = useTranslation();
  return (
    <Form
      title={t('contentTypes.newComponentTitle')}
      kinds={KINDS}
      back={linkOptions({ to: '/develop/components' })}
      backLabel={t('shell.nav.components')}
    />
  );
};
