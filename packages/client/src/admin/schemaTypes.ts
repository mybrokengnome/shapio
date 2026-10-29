import type {
  ChangeSummary,
  ClassifiedChange,
  DefinitionCategory,
  DefinitionInput,
  LocaleDefinition,
  SchemaDefinition,
  ValidationIssue,
} from '@shapio/schema';

/**
 * Schema registry API shapes (package D), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/{models,components,interfaces,schema,locales}/** and routes/schemas/schemaRegistry.ts.
 */

/**
 * `/api/admin/models` serves collections and singletons, `/api/admin/components` components and
 * `/api/admin/interfaces` interfaces (plan interfaces).
 */
export type { DefinitionCategory };

/** Where a definition lives: one site (`site`), or shared with every site (`network`). */
export type DefinitionScope = 'network' | 'site';

export type ActiveDefinition = {
  definition: SchemaDefinition;
  scope: DefinitionScope;
  /** The site a `site` definition belongs to; null when shared. */
  siteId: string | null;
  /** Per-definition version: send it back as `expectedVersion` when changing the definition. */
  version: number;
  hash: string;
  revisionId: string;
  activatedAt: string;
};

/** A list item: the active definition and the change still running for it, if any. */
export type DefinitionListItem = ActiveDefinition & {
  pendingChange: { id: string; status: SchemaChangeStatus } | null;
};

export type SchemaChangeStatus = 'pending' | 'running' | 'activated' | 'failed' | 'canceled';

/** A planned change whose prerequisites run as jobs before the new revision activates. */
/** Entry versions without a value for a field a change made required (listed in the Inbox until filled in). */
export type RequiredGap = {
  step: string;
  /** The definition that declares the field (a model, or a component its value lives in). */
  ownerId: string;
  fieldId: string;
  fieldApiKey?: string;
  /** Entry versions (draft and published, per locale) without a value. */
  versions: number;
  /** The distinct entries they belong to. */
  entries: number;
  sampleEntryIds: string[];
};

/** What an activated change left to do. */
export type SchemaChangeResult = { requiredGaps: RequiredGap[] };

export type SchemaChangeJob = {
  id: string;
  targetType: string;
  targetId: string;
  status: SchemaChangeStatus;
  fromRevisionId: string | null;
  toRevisionId: string | null;
  jobId: string | null;
  /** Why a failed change failed, e.g. `{ reason, invalidCount, sampleEntryIds }`. */
  error: unknown;
  /** What an activated change left to do (entries without a value for a field it made required); else null. */
  outcome: SchemaChangeResult | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type DefinitionDetail = ActiveDefinition & { pendingChange: SchemaChangeJob | null };

/** A prerequisite or follow-up step of a plan (see apps/api/src/schema/planner/steps.ts). */
export type PlanStep = { kind: string; fieldId?: string; modelId?: string; ownerId?: string } & Record<
  string,
  unknown
>;

export type ChangePlan = {
  definitionId: string;
  kind: SchemaDefinition['kind'];
  apiKey: string;
  operation: 'create' | 'update' | 'delete';
  /** The definition's site after the change; null when shared. */
  siteId?: string | null;
  fromVersion: number | null;
  changes: ClassifiedChange[];
  summary: ChangeSummary;
  affectedModelIds: string[];
  prerequisites: PlanStep[];
  followUps: PlanStep[];
  issues: ValidationIssue[];
};

export type PlanStepImpact = {
  key: string;
  kind: string;
  affectedHeads: number;
  invalidHeads?: number;
  /** The distinct entries those failing heads (entry versions) belong to. */
  invalidEntries?: number;
  /**
   * On a `validateRequired` step for a model's own field: entry versions (and entries) that will have no
   * value. They don't block the change; they're listed in the Inbox afterwards.
   */
  missingHeads?: number;
  missingEntries?: number;
  /** On a `convert` step of a type change Shapio cannot convert: live entries that lose their value. */
  droppedEntries?: number;
};

export type PlanImpact = {
  /** Entry heads (every locale and state) of the affected models. */
  affectedHeads: number;
  steps: PlanStepImpact[];
};

export type PlanPreview = { plan: ChangePlan; impact: PlanImpact };

export type ChangeOutcome = {
  status: 'activated' | 'unchanged' | 'pending';
  definitionId: string;
  version?: number | null;
  schemaVersion?: number;
  /** Set when `status` is `pending`: poll `schema.change(changeId)`. */
  changeId?: string;
  toVersion?: number | null;
};

/** What the definition endpoints accept: authored input, or a normalized definition (always valid input). */
export type DefinitionPayload = DefinitionInput | SchemaDefinition;

export type Acknowledgement = { acknowledgeBreaking?: boolean; acknowledgeDestructive?: boolean };

export type CreateDefinitionInput = {
  definition: DefinitionPayload;
  /** Default `site`: the request's site. `network` shares it with all sites (schema.create on every site). */
  scope?: DefinitionScope;
} & Acknowledgement;

/** `PUT /api/admin/{models,components}/:id/scope`: share with all sites, or keep on one site. */
export type ChangeScopeInput = {
  scope: DefinitionScope;
  /** For `site`: the site to keep it on (default: the request's site). */
  siteId?: string;
  /** The definition's active version (409 SCHEMA_VERSION_CONFLICT when it moved). */
  version: number;
};

export type ChangeScopeOutcome = {
  status: 'activated' | 'unchanged';
  definitionId: string;
  scope: DefinitionScope;
  siteId: string | null;
  version: number;
  schemaVersion: number;
};

export type UpdateDefinitionInput = {
  definition: DefinitionPayload;
  expectedVersion: number;
} & Acknowledgement;

export type PlanUpdateInput = { definition: DefinitionPayload; expectedVersion: number };

export type DefinitionRevision = {
  id: string;
  version: number;
  hash: string;
  parentRevisionId: string | null;
  createdByType: string;
  createdById: string | null;
  createdAt: string;
  /** The change that wrote this version: `failed` and `canceled` versions never went live. */
  status: SchemaChangeStatus;
  /** The version the model serves now. */
  active: boolean;
};

/** One revision of a definition with its body. */
export type DefinitionRevisionDetail = DefinitionRevision & { definition: SchemaDefinition };

export type SchemaSummaryItem = {
  id: string;
  kind: SchemaDefinition['kind'];
  apiKey: string;
  label: string;
  version: number;
  hash: string;
  /** The key of the site the definition belongs to; null when shared. */
  site: string | null;
};

export type SchemaSummary = {
  schemaVersion: number;
  defaultLocale: string;
  definitions: SchemaSummaryItem[];
};

/** The opt-in read-only lock (ADR 0002): when on, only `shapio schema apply` changes the schema. */
export type SchemaSettings = { readOnly: boolean; readOnlyReason: string | null; updatedAt: string };

export type UpdateSchemaSettingsInput = { readOnly: boolean; readOnlyReason?: string | null };

export type Locale = LocaleDefinition;

export type CreateLocaleInput = { code: string; label: string; fallbacks?: string[] };

export type UpdateLocaleInput = { label: string; fallbacks?: string[] };

export type SetDefaultLocaleResult = { code: string; changed: boolean };

export type DeleteLocaleResult = {
  code: string;
  /** Heads of localized models in the locale, purged. */
  affectedHeads: number;
  /** Entries that existed only in the locale, deleted. */
  deletedEntries: number;
  /** Entries of non-localized models stored in the locale, moved to the default locale. */
  movedEntries: number;
};
