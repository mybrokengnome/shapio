import type { PresenceHeartbeatInput } from '@shapio/client';
import { ADMIN_PATHS } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '@/stores/session';
import { adminApi, apiBaseUrl, CSRF_HEADER } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** Heartbeat interval while the document is visible (the server forgets a tab after 45s without one). */
export const PRESENCE_HEARTBEAT_MS = 15_000;

/**
 * What publishing would run into, for the pre-flight sheet: read fresh every time it opens (the caller
 * saves first), never retried silently.
 */
export const usePreflight = (modelKey: string, id: string, locale: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.entryDocument.preflight(modelKey, id, locale),
    queryFn: () => withCsrf(() => adminApi.preflight.run(modelKey, id, locale ? { locales: [locale] } : {})),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    meta: silent,
  });

/**
 * Presence: a heartbeat every 15s while this tab shows the entry (paused while hidden); each answer lists
 * who else has it open. Presence is information only: entries lock nothing.
 */
export const useEntryPresenceQuery = (
  modelKey: string,
  id: string | null,
  input: PresenceHeartbeatInput,
  enabled: boolean,
) =>
  useQuery({
    queryKey: queryKeys.presence(modelKey, id ?? ''),
    queryFn: () => withCsrf(() => adminApi.presence.heartbeat(modelKey, id ?? '', input)),
    enabled: enabled && id !== null,
    refetchInterval: PRESENCE_HEARTBEAT_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    meta: silent,
  });

/** Leaves on a normal unmount (navigating away inside the admin). */
export const leavePresence = (modelKey: string, id: string, tabId: string) =>
  withCsrf(() => adminApi.presence.leave(modelKey, id, tabId));

/**
 * Leaves while the page itself goes away (tab closed, reload): a keepalive request outlives the page,
 * which an ordinary fetch would not.
 */
export const leavePresenceOnUnload = (modelKey: string, id: string, tabId: string) => {
  const token = useSessionStore.getState().csrfToken;
  const path = `${ADMIN_PATHS.presence}/${encodeURIComponent(modelKey)}/${encodeURIComponent(id)}`;
  const url = new URL(`${path.replace(/^\//, '')}?tabId=${encodeURIComponent(tabId)}`, apiBaseUrl());
  void fetch(url, {
    method: 'DELETE',
    keepalive: true,
    credentials: 'same-origin',
    headers: token ? { [CSRF_HEADER]: token } : {},
  }).catch(() => undefined);
};
