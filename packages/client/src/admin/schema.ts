import type { RequestFn } from '../request.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { toQueryString } from './query.js';
import type {
  ChangeOutcome,
  CreateDefinitionInput,
  CreateLocaleInput,
  DefinitionCategory,
  DefinitionPayload,
  DefinitionDetail,
  DefinitionListItem,
  DefinitionRevision,
  DeleteLocaleResult,
  Locale,
  PlanPreview,
  PlanUpdateInput,
  SchemaChangeJob,
  SchemaSettings,
  SchemaSummary,
  SetDefaultLocaleResult,
  UpdateDefinitionInput,
  UpdateLocaleInput,
  UpdateSchemaSettingsInput,
} from './schemaTypes.js';

const DEFINITION_PATHS = {
  model: ADMIN_PATHS.models,
  component: ADMIN_PATHS.components,
} as const satisfies Record<DefinitionCategory, string>;

/** Models (collections and singletons) and components share one set of endpoints under their own base. */
export const createDefinitionApi = (request: RequestFn, category: DefinitionCategory) => {
  const base = DEFINITION_PATHS[category];
  return {
    list: async () => (await request<{ items: DefinitionListItem[] }>(base)).items,
    get: (id: string) => request<DefinitionDetail>(withId(base, id)),
    /** Creates and activates a definition (`pending` when prerequisites must run first). */
    create: (body: CreateDefinitionInput) => request<ChangeOutcome>(base, { method: 'POST', body }),
    /** Plan preview of a create: classification and impact, nothing written. */
    planCreate: (definition: DefinitionPayload) =>
      request<PlanPreview>(`${base}/plan`, { method: 'POST', body: { definition } }),
    /** Changes a definition; 409 SCHEMA_VERSION_CONFLICT when `expectedVersion` is stale. */
    update: (id: string, body: UpdateDefinitionInput) =>
      request<ChangeOutcome>(withId(base, id), { method: 'PUT', body }),
    planUpdate: (id: string, body: PlanUpdateInput) =>
      request<PlanPreview>(`${withId(base, id)}/plan`, { method: 'POST', body }),
    /** Soft delete: entries are kept and reappear if the definition is applied again. */
    remove: (id: string, expectedVersion: number) =>
      request<ChangeOutcome>(`${withId(base, id)}${toQueryString({ expectedVersion })}`, {
        method: 'DELETE',
      }),
    revisions: async (id: string) =>
      (await request<{ items: DefinitionRevision[] }>(`${withId(base, id)}/revisions`)).items,
    changes: async (id: string) =>
      (await request<{ items: SchemaChangeJob[] }>(`${withId(base, id)}/changes`)).items,
  };
};

/** Schema-wide endpoints: the version summary, planned-change status, the read-only lock, locales. */
export const createSchemaApi = (request: RequestFn) => ({
  models: createDefinitionApi(request, 'model'),
  components: createDefinitionApi(request, 'component'),
  schema: {
    /** The global schema version and every visible definition's version (cheap; poll it for changes). */
    summary: () => request<SchemaSummary>(ADMIN_PATHS.schema),
    change: (changeId: string) => request<SchemaChangeJob>(withId(ADMIN_PATHS.schemaChanges, changeId)),
    settings: () => request<SchemaSettings>(ADMIN_PATHS.schemaSettings),
    updateSettings: (body: UpdateSchemaSettingsInput) =>
      request<SchemaSettings>(ADMIN_PATHS.schemaSettings, { method: 'PUT', body }),
  },
  locales: {
    list: async () => (await request<{ items: Locale[] }>(ADMIN_PATHS.locales)).items,
    create: (body: CreateLocaleInput) => request<Locale>(ADMIN_PATHS.locales, { method: 'POST', body }),
    update: (code: string, body: UpdateLocaleInput) =>
      request<Locale>(withId(ADMIN_PATHS.locales, code), { method: 'PUT', body }),
    /** A contract change: without `acknowledgeBreaking` the server answers 409 SCHEMA_CHANGE_NOT_ACKNOWLEDGED. */
    setDefault: (code: string, acknowledgeBreaking: boolean) =>
      request<SetDefaultLocaleResult>(`${withId(ADMIN_PATHS.locales, code)}/default`, {
        method: 'POST',
        body: { acknowledgeBreaking },
      }),
    /**
     * Deletes a locale and purges its content. When content exists and `acknowledgeDestructive` is false,
     * the server answers 409 SCHEMA_CHANGE_NOT_ACKNOWLEDGED with `details.plan.impact.affectedHeads`.
     */
    remove: (code: string, acknowledgeDestructive: boolean) =>
      request<DeleteLocaleResult>(
        `${withId(ADMIN_PATHS.locales, code)}${toQueryString({ acknowledgeDestructive: acknowledgeDestructive || undefined })}`,
        { method: 'DELETE' },
      ),
  },
});
