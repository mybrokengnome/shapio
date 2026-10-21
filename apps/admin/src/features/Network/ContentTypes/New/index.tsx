import { linkOptions } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Form } from '@/features/Content/New/Form';

const KINDS = ['collection', 'singleton', 'component', 'interface'] as const;

/**
 * `/network/content-types/new`: a content type, component or interface shared with all sites, live once
 * created.
 */
export const New = () => {
  const { t } = useTranslation();
  return (
    <Form
      title={t('contentTypes.network.newTitle')}
      kinds={KINDS}
      back={linkOptions({ to: '/network/content-types' })}
      backLabel={t('contentTypes.network.title')}
      scope="network"
    />
  );
};
