import {
  ComponentDefinitionInputSchema,
  DefinitionInputSchema,
  InterfaceDefinitionInputSchema,
  LockFileSchema,
  ModelDefinitionInputSchema,
  STABLE_ID_PATTERN,
  type DefinitionCategory,
  type SchemaDefinition,
} from '@shapio/schema';
import { Type, type TSchema } from 'typebox';

/** TypeBox schemas shared by the schema admin routes (models, components, interfaces, schema sync, locales). */

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

const DEFINITION_INPUTS: Readonly<Record<DefinitionCategory, TSchema>> = {
  model: ModelDefinitionInputSchema,
  component: ComponentDefinitionInputSchema,
  interface: InterfaceDefinitionInputSchema,
};

export const definitionInputFor = (category: DefinitionCategory): TSchema => DEFINITION_INPUTS[category];

/** A normalized definition: serialized against the input schema (every normalized one satisfies it). */
export const DefinitionSchema = Type.Unsafe<SchemaDefinition>(DefinitionInputSchema);

/** Where a definition lives: one site (`site`) or every site (`network`, a shared definition). */
export const DefinitionScopeSchema = Type.Union([Type.Literal('network'), Type.Literal('site')]);

export const ActiveDefinitionSchema = Type.Object({
  definition: DefinitionSchema,
  scope: DefinitionScopeSchema,
  /** The site a `site` definition belongs to; null when shared. */
  siteId: NullableString,
  version: Type.Integer(),
  hash: Type.String(),
  revisionId: Type.String(),
  activatedAt: Timestamp,
});

/** Entry versions without a value for a field a change made required (listed in the Inbox until filled in). */
export const RequiredGapSchema = Type.Object({
  step: Type.String(),
  ownerId: Type.String(),
  fieldId: Type.String(),
  fieldApiKey: Type.Optional(Type.String()),
  versions: Type.Integer(),
  entries: Type.Integer(),
  sampleEntryIds: Type.Array(Type.String()),
});

/** What an activated change left to do; null when nothing. */
export const ChangeResultSchema = Type.Union([
  Type.Object({ requiredGaps: Type.Array(RequiredGapSchema) }),
  Type.Null(),
]);

export const ChangeJobSchema = Type.Object({
  id: Type.String(),
  targetType: Type.String(),
  targetId: Type.String(),
  status: Type.String(),
  fromRevisionId: NullableString,
  toRevisionId: NullableString,
  jobId: NullableString,
  error: Type.Unknown(),
  outcome: ChangeResultSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  finishedAt: Type.Union([Timestamp, Type.Null()]),
});

export const ChangePlanSchema = Type.Object({
  definitionId: Type.String(),
  kind: Type.String(),
  apiKey: Type.String(),
  operation: Type.String(),
  /** The definition's site after the change; null when shared. */
  siteId: Type.Optional(NullableString),
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

/** A revision in a definition's history: whether its change went live, and whether it is the active one. */
export const RevisionListItemSchema = Type.Intersect([
  RevisionSummarySchema,
  Type.Object({
    /** The change that wrote it: `failed` and `canceled` revisions never went live. */
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('running'),
      Type.Literal('activated'),
      Type.Literal('failed'),
      Type.Literal('canceled'),
    ]),
    active: Type.Boolean(),
  }),
]);

export const SyncApplyBodySchema = Type.Object(
  {
    /** One entry per local schema file. Validated per file by the service so errors name the file. */
    definitions: Type.Array(Type.Unknown(), { maxItems: 5000 }),
    /**
     * Each file's scope, parallel to `definitions`: its folder (`models/` → network, `sites/<key>/` →
     * site). Absent: every file is shared (format-1 trees and older CLIs). Only creates use it.
     */
    scopes: Type.Optional(Type.Array(DefinitionScopeSchema, { maxItems: 5000 })),
    base: LockFileSchema,
    prune: Type.Optional(Type.Boolean()),
    dryRun: Type.Optional(Type.Boolean()),
    ...AcknowledgementSchema,
  },
  { additionalProperties: false },
);
