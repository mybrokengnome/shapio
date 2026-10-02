import type { EmailDelivery } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { SecretReveal } from '@/components/SecretReveal';
import { formatDateTime } from '@/helpers/formatDate';
import type { RevealedInvitationLink } from '../hooks/useInvitationLinkReveal';

type InvitationLinkProps = {
  link: RevealedInvitationLink;
  emailDelivery: EmailDelivery | undefined;
  onDismiss: () => void;
};

/** A copyable invitation link, shown once above the pending invitations. */
export const InvitationLink = ({ link, emailDelivery, onDismiss }: InvitationLinkProps) => {
  const { t } = useTranslation();
  const expires = formatDateTime(link.expiresAt);
  return (
    <SecretReveal
      title={t('users.invitationLink.title', { email: link.email })}
      description={
        emailDelivery === 'console'
          ? t('users.invitationLink.noEmailDescription', { date: expires })
          : t('users.invitationLink.description', { date: expires })
      }
      label={t('users.invitationLink.label')}
      secret={link.acceptUrl}
      dismissLabel={t('users.invitationLink.done')}
      onDismiss={onDismiss}
    />
  );
};
