import { useTranslation } from 'react-i18next';
import { SecretReveal } from '@/components/SecretReveal';

type GeneratedSecretRevealProps = { secret: string; onDismiss: () => void };

/** A signing secret Shapio generated for a connection (on create, or replacing an unreadable one), shown once. */
export const GeneratedSecretReveal = ({ secret, onDismiss }: GeneratedSecretRevealProps) => {
  const { t } = useTranslation();
  return (
    <SecretReveal
      title={t('publishing.deployments.generatedSecretTitle')}
      description={t('publishing.deployments.generatedSecretDescription')}
      label={t('publishing.deployments.secretLabels.signingSecret')}
      secret={secret}
      dismissLabel={t('publishing.secretDone')}
      onDismiss={onDismiss}
    />
  );
};
