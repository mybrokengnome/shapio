import type { AdminUser } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTokenNames } from '../helpers/tokenNames';

/** What the row's confirmation is asking about: removing the user, or disabling one who has API tokens. */
type ConfirmKind = 'remove' | 'disable';

type AccountConfirmCopy = { title: string; description: string; confirmLabel: string };

/**
 * The row's one confirmation (remove, or disable when the person has API tokens) and its copy. Both name the
 * API tokens the person created, since disabling pauses them and removing revokes them.
 */
export const useAccountConfirmKindAndCopy = (user: AdminUser) => {
  const { t, i18n } = useTranslation();
  const [kind, setKindState] = useState<ConfirmKind | null>(null);
  // The copy of the last confirmation asked for, kept while the popover closes so it does not flicker.
  const [shown, setShown] = useState<ConfirmKind>('remove');
  const setKind = (next: ConfirmKind | null) => {
    if (next) {
      setShown(next);
    }
    setKindState(next);
  };
  const displayName = user.name || user.email;
  const tokens = user.apiTokens;
  const names = formatTokenNames(tokens, i18n.language);
  const copy: Record<ConfirmKind, AccountConfirmCopy> = {
    remove: {
      title: t('users.removeTitle', { name: displayName }),
      description:
        tokens.length > 0
          ? t('users.removeDescriptionWithTokens', { count: tokens.length, names })
          : t('users.removeDescription'),
      confirmLabel: t('common.remove'),
    },
    disable: {
      title: t('users.disableTitle', { name: displayName }),
      description: t('users.disableDescriptionWithTokens', { count: tokens.length, names }),
      confirmLabel: t('users.disable'),
    },
  };
  return {
    kind,
    setKind,
    copy: copy[shown],
    /** Disabling pauses the person's API tokens, so it is confirmed only when they have some. */
    disableNeedsConfirm: user.status === 'active' && tokens.length > 0,
  };
};
