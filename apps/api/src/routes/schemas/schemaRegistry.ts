import {
  ComponentDefinitionInputSchema,
  DefinitionInputSchema,
  LockFileSchema,
  ModelDefinitionInputSchema,
  STABLE_ID_PATTERN,
  type SchemaDefinition,
} from '@shapio/schema';
import { Type, type TSchema } from 'typebox';

/** TypeBox schemas shared by the schema admin routes (models, components, schema sync, locales). */

export const StableIdSchema = Type.String({ pattern: STABLE_ID_PATTERN.source });
export const IdParamsSchema = Type.Object({ id: StableIdSchema });
const Timestamp = Type.String({ format: 'date-time' });
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const JsonObjectList = Type.Array(Type.Record(Type.String(), Type.Unknown()));

export const AcknowledgementSchema = {
  /** Required when the plan breaks the API contract (renames, removals, hidden fields, type changes). */
  acknowledgeBreaking: Type.Optional(Type.Boolean()),
  /** Required when the plan destroys stored data (localized→shared, to-single conversions, locale deletion). */
  acknowledgeDestructive: Type.Optional(Type.Boolean()),
};

export const definitionInputFor = (category: 'model' | 'component'): TSchema =>
  category === 'model' ? ModelDefinitionInputSchema : ComponentDefinitionInputSchema;

/** A normalized definition: serialized against the input schema (every normalized one satisfies it). */
export const DefinitionSchema = Type.Unsafe<SchemaDefinition>(DefinitionInputSchema);

export const ActiveDefinitionSchema = Type.Object({
  definition: DefinitionSchema,
  version: Type.Integer(),
  hash: Type.String(),
  revisionId: Type.String(),
  activatedAt: Timestamp,
});

export const ChangeJobSchema = Type.Object({
  id: Type.String(),
  targetType: Type.String(),
  targetId: Type.String(),
  status: Type.String(),
  fromRevisionId: NullableString,
  toRevisionId: NullableString,
  jobId: NullableString,
  error: Type.Unknown(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  finishedAt: Type.Union([Timestamp, Type.Null()]),
});

export const ChangePlanSchema = Type.Object({
  definitionId: Type.String(),
  kind: Type.String(),
  apiKey: Type.String(),
  operation: Type.String(),
  fromVersion: NullableInt,
  changes: JsonObjectList,
  summary: Type.Object({
    breaking: Type.Boolean(),
    destructive: Type.Boolean(),
    supported: Type.Boolean(),
    metadataOnly: Type.Boolean(),
    prerequisites: Type.Array(Type.String()),
    cleanup: Type.Array(Type.String()),
  }),
  affectedModelIds: Type.Array(Type.String()),
  prerequisites: JsonObjectList,
  followUps: JsonObjectList,
  issues: JsonObjectList,
});

export const ImpactSchema = Type.Object({
  affectedHeads: Type.Integer(),
  steps: JsonObjectList,
});

export const ChangeOutcomeSchema = Type.Object({
  status: Type.Enum(['activated', 'unchanged', 'pending']),
  definitionId: Type.String(),
  version: Type.Optional(NullableInt),
  schemaVersion: Type.Optional(Type.Integer()),
  changeId: Type.Optional(Type.String()),
  toVersion: Type.Optional(NullableInt),
});

export const RevisionSummarySchema = Type.Object({
  id: Type.String(),
  version: Type.Integer(),
  hash: Type.String(),
  parentRevisionId: NullableString,
  createdByType: Type.String(),
  createdById: NullableString,
  createdAt: Timestamp,
});

export const SyncApplyBodySchema = Type.Object(
  {
    /** One entry per local schema file. Validated per file by the service so errors name the file. */
    definitions: Type.Array(Type.Unknown(), { maxItems: 5000 }),
    base: LockFileSchema,
    prune: Type.Optional(Type.Boolean()),
    dryRun: Type.Optional(Type.Boolean()),
    ...AcknowledgementSchema,
  },
  { additionalProperties: false },
);
