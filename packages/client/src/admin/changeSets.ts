import type { RequestFn } from '../request.js';
import type {
  AddChangeSetEntryInput,
  ChangeSet,
  ChangeSetQuery,
  ChangeSetReview,
  ChangeSetSummary,
  ChangeSetTimelineEvent,
  CreateChangeSetInput,
  PutSchemaDraftInput,
  ScheduleChangeSetInput,
  SchemaDraft,
  ShipChangeSetInput,
  Snapshot,
  SnapshotPage,
  SnapshotQuery,
  UnassignedEntry,
  UpdateChangeSetInput,
} from './changeSetTypes.js';
import { ADMIN_PATHS, withId } from './paths.js';
import type { Page } from './publishingTypes.js';
import { toQueryString } from './query.js';

const setPath = (id: string) => withId(ADMIN_PATHS.changeSets, id);
const draftPath = (id: string, definitionId: string) =>
  `${setPath(id)}/schema/${encodeURIComponent(definitionId)}`;

/** Change sets (schema + content shipped as one snapshot) and the snapshot ledger. */
export const createChangeSetsApi = (request: RequestFn) => ({
  changeSets: {
    list: (query: ChangeSetQuery = {}) =>
      request<Page<ChangeSetSummary>>(`${ADMIN_PATHS.changeSets}${toQueryString(query)}`),
    get: (id: string) => request<ChangeSet>(setPath(id)),
    create: (body: CreateChangeSetInput) =>
      request<ChangeSet>(ADMIN_PATHS.changeSets, { method: 'POST', body }),
    update: (id: string, body: UpdateChangeSetInput) =>
      request<ChangeSet>(setPath(id), { method: 'PATCH', body }),
    /** Keeps the set as history (`discarded`) and deletes its schema drafts. */
    discard: (id: string) => request<ChangeSet>(`${setPath(id)}/discard`, { method: 'POST' }),
    addEntry: (id: string, body: AddChangeSetEntryInput) =>
      request<ChangeSet>(`${setPath(id)}/items`, { method: 'POST', body }),
    removeItem: (id: string, itemId: string) =>
      request<ChangeSet>(`${setPath(id)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    getSchemaDraft: (id: string, definitionId: string) => request<SchemaDraft>(draftPath(id, definitionId)),
    putSchemaDraft: (id: string, definitionId: string, body: PutSchemaDraftInput) =>
      request<SchemaDraft>(draftPath(id, definitionId), { method: 'PUT', body }),
    removeSchemaDraft: (id: string, definitionId: string) =>
      request<ChangeSet>(draftPath(id, definitionId), { method: 'DELETE' }),
    review: (id: string) => request<ChangeSetReview>(`${setPath(id)}/review`),
    /**
     * Resolves with the set: `shipped` (or `failed`) when it shipped inline, `shipping` (HTTP 202) when
     * prerequisites run in the background. Poll `get` until it leaves `shipping`.
     */
    ship: (id: string, body: ShipChangeSetInput) =>
      request<ChangeSet>(`${setPath(id)}/ship`, { method: 'POST', body }),
    schedule: (id: string, body: ScheduleChangeSetInput) =>
      request<ChangeSet>(`${setPath(id)}/schedule`, { method: 'POST', body }),
    unschedule: (id: string) => request<ChangeSet>(`${setPath(id)}/unschedule`, { method: 'POST' }),
    timeline: async (id: string) =>
      (await request<{ items: ChangeSetTimelineEvent[] }>(`${setPath(id)}/timeline`)).items,
    unassigned: (query: { cursor?: string; limit?: number } = {}) =>
      request<Page<UnassignedEntry>>(`${ADMIN_PATHS.changeSets}/unassigned${toQueryString(query)}`),
  },
  snapshots: {
    list: (query: SnapshotQuery = {}) =>
      request<SnapshotPage>(`${ADMIN_PATHS.snapshots}${toQueryString(query)}`),
    get: (seq: number) => request<Snapshot>(`${ADMIN_PATHS.snapshots}/${seq}`),
    /** Creates an open restore change set (reviewable); nothing goes live until it ships. */
    restore: (seq: number) =>
      request<ChangeSet>(`${ADMIN_PATHS.snapshots}/${seq}/restore`, { method: 'POST' }),
  },
});
