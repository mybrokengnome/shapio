import type { RequestFn } from '../request.js';
import type {
  ContentCounts,
  ContentHealthPage,
  ContentHealthQuery,
  ContentHealthSummary,
  EntryPresence,
  ModelPresence,
  PresenceHeartbeatInput,
  PreflightInput,
  PreflightResponse,
} from './editingTypes.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { toQueryString } from './query.js';

const entryPath = (base: string, modelKey: string, id: string) => withId(withId(base, modelKey), id);

/** The entry document's endpoints: pre-flight, content health (the Inbox), presence and counts. */
export const createEditingApi = (request: RequestFn) => ({
  preflight: {
    /** What publishing these locales would run into, without publishing (no hooks, no locks). */
    run: (modelKey: string, id: string, body: PreflightInput = {}) =>
      request<PreflightResponse>(`${entryPath(ADMIN_PATHS.content, modelKey, id)}/preflight`, {
        method: 'POST',
        body,
      }),
  },
  contentHealth: {
    list: (query: ContentHealthQuery = {}) =>
      request<ContentHealthPage>(`${ADMIN_PATHS.contentHealth}${toQueryString(query)}`),
    summary: () => request<ContentHealthSummary>(`${ADMIN_PATHS.contentHealth}/summary`),
  },
  presence: {
    /** Heartbeat (every 15s while the document is visible); returns who else has the entry open. */
    heartbeat: (modelKey: string, id: string, body: PresenceHeartbeatInput) =>
      request<EntryPresence>(entryPath(ADMIN_PATHS.presence, modelKey, id), { method: 'PUT', body }),
    entry: (modelKey: string, id: string) =>
      request<EntryPresence>(entryPath(ADMIN_PATHS.presence, modelKey, id)),
    /** Everyone editing an entry of the model (list rows). */
    model: (modelKey: string) => request<ModelPresence>(withId(ADMIN_PATHS.presence, modelKey)),
    leave: (modelKey: string, id: string, tabId: string) =>
      request<void>(`${entryPath(ADMIN_PATHS.presence, modelKey, id)}${toQueryString({ tabId })}`, {
        method: 'DELETE',
      }),
  },
  contentCounts: {
    list: () => request<ContentCounts>(ADMIN_PATHS.contentCounts),
  },
});
