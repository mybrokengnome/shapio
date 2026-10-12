import type { DraftState, PresencePerson } from '@shapio/client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { leavePresence, leavePresenceOnUnload, useEntryPresenceQuery } from '@/api/entryDocument';
import { logError } from '@/helpers/reportError';

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

const isVisible = () => document.visibilityState === 'visible';

const NO_PEOPLE: PresencePerson[] = [];
const NO_DRAFTS: DraftState[] = [];

/**
 * This tab's heartbeat while it is visible: who else has this entry open, and every locale's draft version
 * as the server has it (so the document learns about saves made elsewhere). The tab leaves when the
 * document closes (a keepalive request when the page itself goes away). Information only; nothing locks.
 */
export const useEntryHeartbeat = (modelKey: string, entryId: string | null, locale: string | null) => {
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
  return { people: presence.data?.people ?? NO_PEOPLE, drafts: presence.data?.drafts ?? NO_DRAFTS };
};
