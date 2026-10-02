import { useTranslation } from 'react-i18next';
import type { ConfirmedAction } from '../../../hooks/useAppUserActions';

type ConfirmCopy = { title: string; description: string; confirmLabel: string; tone: 'danger' | 'default' };

/** The inline confirmation's question, consequence, button and tone for each row action. */
export const useConfirmCopy = (action: ConfirmedAction, name: string): ConfirmCopy => {
  const { t } = useTranslation();
  switch (action) {
    case 'block':
      return {
        title: t('appUsers.blockTitle', { name }),
        description: t('appUsers.blockDescription'),
        confirmLabel: t('appUsers.block'),
        tone: 'danger',
      };
    case 'unblock':
      return {
        title: t('appUsers.unblockTitle', { name }),
        description: t('appUsers.unblockDescription'),
        confirmLabel: t('appUsers.unblock'),
        tone: 'default',
      };
    case 'remove':
      return {
        title: t('appUsers.removeTitle', { name }),
        description: t('appUsers.removeDescription'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      };
  }
};
