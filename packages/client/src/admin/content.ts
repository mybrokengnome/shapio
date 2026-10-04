import type { RequestFn } from '../request.js';
import { toContentQueryString } from './contentQuery.js';
import type {
  AdminEntry,
  AdminEntryPage,
  ContentListQuery,
  CreateEntryInput,
  EditorManifest,
  EntryLocalesInput,
  ExtensionThemeList,
  RevisionDetail,
  RevisionSummary,
  UpdateEntryInput,
} from './contentTypes.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { toQueryString } from './query.js';

const modelPath = (modelKey: string) => withId(ADMIN_PATHS.content, modelKey);
const entryPath = (modelKey: string, id: string) => withId(modelPath(modelKey), id);
const revisionsPath = (modelKey: string, id: string) => `${entryPath(modelKey, id)}/revisions`;

/**
 * Content of any model through the generic admin routes (`/api/admin/content/:modelKey`, where `modelKey`
 * is the model's singular API ID for collections too; only the delivery API uses the plural). Drafts are read
 * and written here; publishing is per locale. Writes carry the draft `version` the editor saw and fail with
 * 409 CONTENT_VERSION_CONFLICT (or SCHEMA_CHANGED) when it moved.
 */
export const createContentApi = (request: RequestFn) => ({
  content: {
    list: (modelKey: string, query: ContentListQuery = {}) =>
      request<AdminEntryPage>(`${modelPath(modelKey)}${toContentQueryString(query)}`),
    get: (modelKey: string, id: string, { locale }: { locale?: string } = {}) =>
      request<AdminEntry>(`${entryPath(modelKey, id)}${toQueryString({ locale })}`),
    /** Fully validated (`required` included); 422 CONTENT_INVALID with `details.issues`. */
    create: (modelKey: string, body: CreateEntryInput) =>
      request<AdminEntry>(modelPath(modelKey), { method: 'POST', body }),
    /** Saves a patch of one locale's draft; `autosave` skips `required` and creates no revision. */
    update: (modelKey: string, id: string, body: UpdateEntryInput) =>
      request<AdminEntry>(entryPath(modelKey, id), { method: 'PUT', body }),
    /** 409 ENTRY_REFERENCED with `details.referrers` while other entries point at it. */
    remove: (modelKey: string, id: string) => request<void>(entryPath(modelKey, id), { method: 'DELETE' }),
    duplicate: (modelKey: string, id: string) =>
      request<AdminEntry>(`${entryPath(modelKey, id)}/duplicate`, { method: 'POST' }),
    publish: (modelKey: string, id: string, body: EntryLocalesInput = {}) =>
      request<AdminEntry>(`${entryPath(modelKey, id)}/publish`, { method: 'POST', body }),
    unpublish: (modelKey: string, id: string, body: EntryLocalesInput = {}) =>
      request<AdminEntry>(`${entryPath(modelKey, id)}/unpublish`, { method: 'POST', body }),
    revisions: async (modelKey: string, id: string, { locale }: { locale?: string } = {}) =>
      (
        await request<{ items: RevisionSummary[] }>(
          `${revisionsPath(modelKey, id)}${toQueryString({ locale })}`,
        )
      ).items,
    revision: (modelKey: string, id: string, revisionId: string) =>
      request<RevisionDetail>(withId(revisionsPath(modelKey, id), revisionId)),
    /** Brings an older revision back as the new draft of its locale (a new revision). */
    restore: (modelKey: string, id: string, revisionId: string, expectedVersion: number) =>
      request<AdminEntry>(`${withId(revisionsPath(modelKey, id), revisionId)}/restore`, {
        method: 'POST',
        body: { expectedVersion },
      }),
  },
  extensions: {
    /** Custom field editors the project installed (`shapio.config` + `extensions/editors/*.js`). */
    editors: () => request<EditorManifest>(ADMIN_PATHS.editorManifest),
    /** Admin colour themes the project declares (`shapio.config` `themes`). Public: no session needed. */
    themes: () => request<ExtensionThemeList>(ADMIN_PATHS.extensionThemes),
  },
});
