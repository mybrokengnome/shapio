import { useTranslation } from 'react-i18next';
import { SecretReveal } from '@/components/SecretReveal';
import { SignatureHelp } from '../../SignatureHelp';

type SigningSecretRevealProps = { secret: string; onDismiss: () => void };

/** A webhook's signing secret, shown once at the top of the page after creating it or rotating it. */
export const SigningSecretReveal = ({ secret, onDismiss }: SigningSecretRevealProps) => {
  const { t } = useTranslation();
  return (
    <SecretReveal
      title={t('publishing.webhooks.secretTitle')}
      description={t('publishing.webhooks.secretDescription')}
      label={t('publishing.webhooks.secretLabel')}
      secret={secret}
      dismissLabel={t('publishing.secretDone')}
      onDismiss={onDismiss}
      hint={<SignatureHelp description={t('publishing.webhooks.signatureDescription')} />}
    />
  );
};
