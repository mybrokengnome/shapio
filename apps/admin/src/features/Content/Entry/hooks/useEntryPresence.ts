import { useEffect, useState, useSyncExternalStore } from 'react';
import { leavePresence, leavePresenceOnUnload, useEntryPresenceQuery } from '@/api/entryDocument';
import { logError } from '@/helpers/reportError';

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

const isVisible = () => document.visibilityState === 'visible';

/**
 * Who else has this entry open: this tab sends a heartbeat while it is visible and leaves when the
 * document closes (a keepalive request when the page itself goes away). Information only; nothing locks.
 */
export const useEntryPresence = (modelKey: string, entryId: string | null, locale: string | null) => {
  const [tabId] = useState(() => crypto.randomUUID());
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const presence = useEntryPresenceQuery(modelKey, entryId, { tabId, locale }, visible);
  useEffect(() => {
    if (!entryId) {
      return undefined;
    }
    const onPageHide = () => leavePresenceOnUnload(modelKey, entryId, tabId);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      leavePresence(modelKey, entryId, tabId).catch((error: unknown) =>
        logError(error, 'leaving an entry (presence)'),
      );
    };
  }, [modelKey, entryId, tabId]);
  return presence.data?.people ?? [];
};
