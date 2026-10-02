import type {
  ChangeSummary,
  ClassifiedChange,
  DefinitionInput,
  LocaleDefinition,
  SchemaDefinition,
  ValidationIssue,
} from '@shapio/schema';

/**
 * Schema registry API shapes (package D), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/{models,components,schema,locales}/** and routes/schemas/schemaRegistry.ts.
 */

/** `/api/admin/models` serves collections and singletons; `/api/admin/components` serves components. */
export type DefinitionCategory = 'model' | 'component';

export type ActiveDefinition = {
  definition: SchemaDefinition;
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

export type SchemaChangeStatus = 'pending' | 'running' | 'activated' | 'failed' | 'cancelled';

/** A planned change whose prerequisites run as jobs before the new revision activates. */
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
  fromVersion: number | null;
  changes: ClassifiedChange[];
  summary: ChangeSummary;
  affectedModelIds: string[];
  prerequisites: PlanStep[];
  followUps: PlanStep[];
  issues: ValidationIssue[];
};

export type PlanStepImpact = { key: string; kind: string; affectedHeads: number; invalidHeads?: number };

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

export type CreateDefinitionInput = { definition: DefinitionPayload } & Acknowledgement;

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
};

export type SchemaSummaryItem = {
  id: string;
  kind: SchemaDefinition['kind'];
  apiKey: string;
  label: string;
  version: number;
  hash: string;
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

export type DeleteLocaleResult = { code: string; affectedHeads: number };
