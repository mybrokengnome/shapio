import type { AdminAppUser } from '@shapio/client';
import { toast } from 'sonner';
import { useRemoveAppUser, useResendAppUserConfirmation, useSetAppUserBlocked } from '@/api/appUsers';
import { i18next } from '@/app/i18n';

/** The row actions that ask first. */
export type ConfirmedAction = 'block' | 'unblock' | 'remove';

/**
 * Row actions on app users. Block, unblock and delete resolve once done, so the inline confirmation can wait
 * for them; resending the confirmation email doesn't ask.
 */
export const useAppUserActions = () => {
  const setBlocked = useSetAppUserBlocked();
  const resend = useResendAppUserConfirmation();
  const remove = useRemoveAppUser();
  const run = async (action: ConfirmedAction, user: AdminAppUser) => {
    if (action === 'remove') {
      await remove.mutateAsync(user.id);
      toast.success(i18next.t('appUsers.removed'));
      return;
    }
    const blocked = action === 'block';
    await setBlocked.mutateAsync({ id: user.id, blocked });
    toast.success(i18next.t(blocked ? 'appUsers.blockedToast' : 'appUsers.unblockedToast'));
  };
  return {
    run,
    resendConfirmation: (user: AdminAppUser) =>
      resend.mutate(user.id, {
        onSuccess: () => toast.success(i18next.t('appUsers.confirmationSent', { email: user.email })),
      }),
  };
};
