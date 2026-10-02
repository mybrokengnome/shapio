import { linkOptions } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Form } from './Form';

const KINDS = ['collection', 'singleton'] as const;

/** `/content/new`: a new content type (a place for editors), live as soon as it is created. */
export const New = () => {
  const { t } = useTranslation();
  return (
    <Form
      title={t('contentTypes.newTitle')}
      kinds={KINDS}
      back={linkOptions({ to: '/content' })}
      backLabel={t('content.title')}
    />
  );
};
