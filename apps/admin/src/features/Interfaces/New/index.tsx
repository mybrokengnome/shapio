import { linkOptions } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Form } from '@/features/Content/New/Form';

const KINDS = ['interface'] as const;

/** `/develop/interfaces/new`: an interface (Develop → Interfaces). */
export const New = () => {
  const { t } = useTranslation();
  return (
    <Form
      title={t('interfaces.newTitle')}
      kinds={KINDS}
      back={linkOptions({ to: '/develop/interfaces' })}
      backLabel={t('interfaces.title')}
    />
  );
};
