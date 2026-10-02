import type { EmailDelivery, Invitation, InvitationLink } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/api/auth';
import { useIssueInvitationLink } from '@/api/users';
import { settle } from '@/helpers/settle';

export type RevealedInvitationLink = InvitationLink & { email: string };

/**
 * Copyable invitation links, shown once in a `SecretReveal` (never in a URL). Without real email delivery
 * the link is issued right after inviting, since it is the only way the invitee can join; with email, the
 * "Invitation sent" toast offers it instead. Issuing a link makes earlier ones stop working.
 */
export const useInvitationLinkReveal = () => {
  const { t } = useTranslation();
  const emailDelivery: EmailDelivery | undefined = useMe().data?.emailDelivery;
  const issueLink = useIssueInvitationLink();
  const [revealed, setRevealed] = useState<RevealedInvitationLink | undefined>(undefined);
  const reveal = async ({ id, email }: Pick<Invitation, 'id' | 'email'>) => {
    const link = await issueLink.mutateAsync(id);
    setRevealed({ ...link, email });
  };
  const announceInvitation = async (invitation: Invitation) => {
    if (emailDelivery === 'console') {
      await reveal(invitation);
      return;
    }
    toast.success(t('users.invited', { email: invitation.email }), {
      action: { label: t('users.copyLink'), onClick: () => void settle(reveal(invitation)) },
    });
  };
  return {
    revealed,
    emailDelivery,
    reveal,
    announceInvitation,
    dismiss: () => setRevealed(undefined),
    /** For the invite sheet's `onCloseAutoFocus`: focus stays on the reveal's copy button. */
    keepFocusOnReveal: (event: Event) => {
      if (revealed) {
        event.preventDefault();
      }
    },
  };
};
