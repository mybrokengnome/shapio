import { Type, type Static } from 'typebox';
import {
  DateTimeInputSchema,
  DateTimeSchema,
  IdParamsSchema,
  NullableDateTimeSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import {
  CursorQueryFields,
  LocaleCodeSchema,
  ModelKeySchema,
  Nullable,
  NullableInteger,
  NullableString,
  PageSchema,
  PublicationActionSchema,
  SiteRefSchema,
  VersionSchema,
} from '../../schemas/publishing.js';
import {
  ChangePlanSchema,
  DefinitionSchema,
  ImpactSchema,
  StableIdSchema,
} from '../../schemas/schemaRegistry.js';

/**
 * /api/admin/change-sets (developer-face plan §5): a named bundle of schema drafts and entry publications that
 * ships as ONE publication snapshot. These schemas are the contract the admin (D2) builds against.
 */

export const CHANGE_SET_STATUSES = [
  'open',
  'scheduled',
  'shipping',
  'shipped',
  'failed',
  'discarded',
] as const;
export const ChangeSetStatusSchema = Type.Enum(CHANGE_SET_STATUSES);
/** While `shipping`: preparing (prerequisite dry runs, index builds) or activating (the final transaction). */
export const ShipPhaseSchema = Nullable(Type.Enum(['preparing', 'activating']));
export const ChangeSetSourceSchema = Type.Enum(['manual', 'release', 'restore', 'builder', 'assist']);
export const ItemStatusSchema = Type.Enum(['pending', 'done', 'failed']);
export const DefinitionCategorySchema = Type.Enum(['model', 'component']);
export const SchemaOperationSchema = Type.Enum(['create', 'update', 'delete']);

const ActorSchema = Type.Object({
  type: Type.Enum(['admin', 'token', 'system']),
  id: NullableString,
  name: NullableString,
});

/** Why a ship failed: the message, and the item that stopped it (null when not tied to one item). */
export const ChangeSetErrorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  itemId: Nullable(UuidSchema),
  details: Type.Optional(Type.Unknown()),
});

export const EntryItemSchema = Type.Object({
  id: UuidSchema,
  kind: Type.Literal('entry'),
  position: Type.Integer(),
  entryId: UuidSchema,
  modelId: UuidSchema,
  modelKey: NullableString,
  /** The entry's title (the model's title field, draft first); null when it has none. */
  title: NullableString,
  locale: Type.String(),
  action: PublicationActionSchema,
  /** Restore items publish this exact revision instead of the current draft. */
  sourceRevisionId: Nullable(UuidSchema),
  status: ItemStatusSchema,
  error: NullableString,
});

export const SchemaItemSchema = Type.Object({
  id: UuidSchema,
  kind: Type.Literal('schema'),
  position: Type.Integer(),
  draftId: UuidSchema,
  definitionId: StableIdSchema,
  category: DefinitionCategorySchema,
  apiKey: Type.String(),
  operation: SchemaOperationSchema,
  /** The active version the draft was based on; null for a new definition. */
  baseVersion: NullableInteger,
  /** Version of the draft row (optimistic concurrency for `PUT …/schema/:definitionId`). */
  draftVersion: Type.Integer(),
  status: ItemStatusSchema,
  error: NullableString,
});

export const ChangeSetItemSchema = Type.Union([EntryItemSchema, SchemaItemSchema]);

const summaryFields = {
  id: UuidSchema,
  title: Type.String(),
  description: Type.String(),
  status: ChangeSetStatusSchema,
  shipPhase: ShipPhaseSchema,
  source: ChangeSetSourceSchema,
  /** For restore sets: the snapshot being restored. */
  restoreOfSnapshot: NullableInteger,
  scheduledFor: NullableDateTimeSchema,
  /** Connection whose deploy is triggered (pinned to the shipped snapshot) after the set ships. */
  deploymentConnectionId: Nullable(UuidSchema),
  /** The run triggered after shipping, if any. */
  deploymentRunId: Nullable(UuidSchema),
  shippedAt: NullableDateTimeSchema,
  /** The publication snapshot the set went live in (`?snapshot=`). */
  shippedSnapshot: NullableInteger,
  /** The global schema version right after shipping, when the set had schema items. */
  schemaVersionAfter: NullableInteger,
  error: Nullable(ChangeSetErrorSchema),
  entryItemCount: Type.Integer(),
  schemaItemCount: Type.Integer(),
  createdBy: ActorSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  version: Type.Integer(),
};

export const ChangeSetSummarySchema = Type.Object(summaryFields);
export const ChangeSetSchema = Type.Object({ ...summaryFields, items: Type.Array(ChangeSetItemSchema) });

const errors = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  422: ErrorResponseSchema,
};

// List, create, read, update, discard -------------------------------------------------------------

export const ListChangeSetsQuerySchema = Type.Object(
  {
    /** Comma-separated statuses; default: every status except `discarded`. */
    status: Type.Optional(Type.String({ maxLength: 200, pattern: '^[a-z,]+$' })),
    ...CursorQueryFields,
  },
  { additionalProperties: false },
);
export type ListChangeSetsQuery = Static<typeof ListChangeSetsQuerySchema>;
export const listChangeSetsSchema = {
  querystring: ListChangeSetsQuerySchema,
  response: { 200: PageSchema(ChangeSetSummarySchema), ...errors },
};

export const getChangeSetSchema = { params: IdParamsSchema, response: { 200: ChangeSetSchema, ...errors } };

const TitleSchema = Type.String({ minLength: 1, maxLength: 200 });
const DescriptionSchema = Type.String({ maxLength: 5000 });

export const CreateChangeSetBodySchema = Type.Object(
  {
    title: TitleSchema,
    description: Type.Optional(DescriptionSchema),
    /** `builder`: a one-item set the model builder ships at once ("Review & ship now"). */
    source: Type.Optional(Type.Enum(['manual', 'builder'])),
  },
  { additionalProperties: false },
);
export type CreateChangeSetBody = Static<typeof CreateChangeSetBodySchema>;
export const createChangeSetSchema = {
  body: CreateChangeSetBodySchema,
  response: { 201: ChangeSetSchema, ...errors },
};

export const UpdateChangeSetBodySchema = Type.Object(
  {
    title: Type.Optional(TitleSchema),
    description: Type.Optional(DescriptionSchema),
    /** Set or clear the connection deployed after shipping. */
    deploymentConnectionId: Type.Optional(Nullable(UuidSchema)),
    expectedVersion: VersionSchema,
  },
  { additionalProperties: false },
);
export type UpdateChangeSetBody = Static<typeof UpdateChangeSetBodySchema>;
export const updateChangeSetSchema = {
  params: IdParamsSchema,
  body: UpdateChangeSetBodySchema,
  response: { 200: ChangeSetSchema, ...errors },
};

/** Discarding keeps the set as history (status `discarded`) and deletes its schema drafts. */
export const changeSetActionSchema = {
  params: IdParamsSchema,
  response: { 200: ChangeSetSchema, ...errors },
};

// Entry items --------------------------------------------------------------------------------------

export const AddEntryItemBodySchema = Type.Object(
  {
    modelKey: ModelKeySchema,
    entryId: UuidSchema,
    /** Omit for non-localized models (and for the default locale). */
    locale: Type.Optional(LocaleCodeSchema),
    action: PublicationActionSchema,
  },
  { additionalProperties: false },
);
export type AddEntryItemBody = Static<typeof AddEntryItemBodySchema>;
export const addEntryItemSchema = {
  params: IdParamsSchema,
  body: AddEntryItemBodySchema,
  response: { 200: ChangeSetSchema, ...errors },
};

export const ItemParamsSchema = Type.Object({ id: UuidSchema, itemId: UuidSchema });
export type ItemParams = Static<typeof ItemParamsSchema>;
export const removeItemSchema = { params: ItemParamsSchema, response: { 200: ChangeSetSchema, ...errors } };

// Schema drafts ------------------------------------------------------------------------------------

export const DraftParamsSchema = Type.Object({ id: UuidSchema, definitionId: StableIdSchema });
export type DraftParams = Static<typeof DraftParamsSchema>;

export const SchemaDraftSchema = Type.Object({
  id: UuidSchema,
  changeSetId: UuidSchema,
  definitionId: StableIdSchema,
  category: DefinitionCategorySchema,
  operation: SchemaOperationSchema,
  baseVersion: NullableInteger,
  /** The proposed definition (normalized); null when the draft deletes the definition. */
  definition: Nullable(DefinitionSchema),
  version: Type.Integer(),
  updatedBy: ActorSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const getSchemaDraftSchema = {
  params: DraftParamsSchema,
  response: { 200: SchemaDraftSchema, ...errors },
};

export const PutSchemaDraftBodySchema = Type.Object(
  {
    category: DefinitionCategorySchema,
    /**
     * The whole proposed definition (validated like the builder's plan endpoints), or null to delete the
     * definition when the set ships.
     */
    definition: Nullable(Type.Unknown()),
    /** The active version the edit is based on (null: a new definition). Checked again when shipping. */
    baseVersion: Nullable(VersionSchema),
    /** The draft row version the caller saw; omit when creating the draft. */
    expectedDraftVersion: Type.Optional(VersionSchema),
  },
  { additionalProperties: false },
);
export type PutSchemaDraftBody = Static<typeof PutSchemaDraftBodySchema>;
export const putSchemaDraftSchema = {
  params: DraftParamsSchema,
  body: PutSchemaDraftBodySchema,
  response: { 200: SchemaDraftSchema, ...errors },
};

export const deleteSchemaDraftSchema = {
  params: DraftParamsSchema,
  response: { 200: ChangeSetSchema, ...errors },
};

// Review -------------------------------------------------------------------------------------------

export const FieldDiffSchema = Type.Object({
  fieldId: Type.String(),
  apiKey: Type.String(),
  label: Type.String(),
  before: Type.Unknown(),
  after: Type.Unknown(),
});

export const ReviewIssueSchema = Type.Object({
  path: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const ReviewEntryItemSchema = Type.Object({
  itemId: UuidSchema,
  entryId: UuidSchema,
  modelId: UuidSchema,
  modelKey: NullableString,
  title: NullableString,
  locale: Type.String(),
  action: PublicationActionSchema,
  sourceRevisionId: Nullable(UuidSchema),
  /**
   * The draft head version this review shows; send it back in `ship.itemVersions` so an interactive ship
   * refuses (409 CHANGE_SET_STALE) when the draft moved. Null when the item does not publish the draft.
   */
  draftVersion: NullableInteger,
  /** Live state now: not published, published and identical, or published with a different version. */
  liveState: Type.Enum(['unpublished', 'published', 'modified', 'missing']),
  /** Field-level before (live) → after (what ships), readable fields only. */
  fields: Type.Array(FieldDiffSchema),
  /** Validation against the schema the set ships with; non-empty means the ship would fail. */
  issues: Type.Array(ReviewIssueSchema),
});

export const ReviewSchemaItemSchema = Type.Object({
  itemId: UuidSchema,
  draftId: UuidSchema,
  definitionId: StableIdSchema,
  category: DefinitionCategorySchema,
  apiKey: Type.String(),
  operation: SchemaOperationSchema,
  baseVersion: NullableInteger,
  /** The definition's active version now (null: not active). */
  activeVersion: NullableInteger,
  /** The active version moved since the draft was based on it: shipping refuses until it is rebased. */
  stale: Type.Boolean(),
  /** Planner output (classification, prerequisites, conversions) and its impact; null when invalid. */
  plan: Nullable(ChangePlanSchema),
  impact: Nullable(ImpactSchema),
  /** Entries of the affected models per site: the schema is shared, so shipping converts every site's content. */
  affectedEntriesBySite: Type.Array(Type.Object({ site: SiteRefSchema, entries: Type.Integer() })),
  issues: Type.Array(ReviewIssueSchema),
  /** Other open sets with a draft of the same definition. */
  alsoChangedIn: Type.Array(Type.Object({ id: UuidSchema, title: Type.String() })),
});

export const NOT_RESTORABLE_REASONS = [
  'entry_deleted',
  'model_missing',
  'publishing_disabled',
  'localization_changed',
  'locale_missing',
  'invalid',
  'unique_conflict',
] as const;

export const NotRestorableSchema = Type.Object({
  entryId: UuidSchema,
  modelId: UuidSchema,
  modelKey: NullableString,
  locale: Type.String(),
  reason: Type.Enum(NOT_RESTORABLE_REASONS),
  detail: Type.String(),
});

export const FieldConsumersSchema = Type.Object({
  modelId: UuidSchema,
  fieldId: Type.String(),
  apiKey: Type.String(),
  consumers: Type.Array(
    Type.Object({
      /** The site the reads were made on. */
      site: SiteRefSchema,
      /** `token:<id>`, `app_users` or `anonymous`. */
      principalKey: Type.String(),
      /** The token's name; null for app users and anonymous readers. */
      label: NullableString,
      reads: Type.Integer(),
      lastReadAt: NullableDateTimeSchema,
      /** `implicit`: the reader requested the whole model (no field selection). */
      selection: Type.Enum(['explicit', 'implicit']),
    }),
  ),
  /**
   * Readers on other sites, as totals, when the viewer holds no role on every site; null when the viewer
   * sees every site's readers above.
   */
  otherSites: Nullable(Type.Object({ consumers: Type.Integer(), reads: Type.Integer() })),
});

export const ChangeSetReviewSchema = Type.Object({
  changeSet: ChangeSetSchema,
  entries: Type.Array(ReviewEntryItemSchema),
  schema: Type.Array(ReviewSchemaItemSchema),
  /** Restore sets: live entries that cannot be restored, with the reason. */
  notRestorable: Type.Array(NotRestorableSchema),
  /** Readers of fields the set's breaking schema changes affect (last `usageDays` days). */
  consumers: Type.Array(FieldConsumersSchema),
  usageDays: Type.Integer(),
  checks: Type.Object({
    breaking: Type.Boolean(),
    destructive: Type.Boolean(),
    /** Anything here makes `ship` refuse (stale drafts, invalid entries, invalid schema). */
    blocking: Type.Array(ReviewIssueSchema),
    warnings: Type.Array(ReviewIssueSchema),
  }),
  /** Fixed notices, e.g. `NEW_FIELDS_AFTER_SHIP` (entries cannot use fields only the drafts add). */
  notices: Type.Array(Type.String()),
});

export const getReviewSchema = {
  params: IdParamsSchema,
  response: { 200: ChangeSetReviewSchema, ...errors },
};

// Ship, schedule ------------------------------------------------------------------------------------

export const ShipBodySchema = Type.Object(
  {
    expectedVersion: VersionSchema,
    acknowledgeBreaking: Type.Optional(Type.Boolean()),
    acknowledgeDestructive: Type.Optional(Type.Boolean()),
    /**
     * The draft versions the review showed (strict ship): any entry item whose draft moved since makes the
     * ship refuse with 409 CHANGE_SET_STALE. Items not listed are not checked.
     */
    itemVersions: Type.Optional(
      Type.Array(Type.Object({ itemId: UuidSchema, draftVersion: Type.Integer() }), { maxItems: 5000 }),
    ),
  },
  { additionalProperties: false },
);
export type ShipBody = Static<typeof ShipBodySchema>;
/** 200: shipped inline (or failed). 202: shipping in the background (prerequisites to run). */
export const shipSchema = {
  params: IdParamsSchema,
  body: ShipBodySchema,
  response: { 200: ChangeSetSchema, 202: ChangeSetSchema, ...errors },
};

export const ScheduleBodySchema = Type.Object(
  {
    at: DateTimeInputSchema,
    expectedVersion: VersionSchema,
    acknowledgeBreaking: Type.Optional(Type.Boolean()),
    acknowledgeDestructive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ScheduleBody = Static<typeof ScheduleBodySchema>;
export const scheduleSchema = {
  params: IdParamsSchema,
  body: ScheduleBodySchema,
  response: { 200: ChangeSetSchema, ...errors },
};

// Timeline ------------------------------------------------------------------------------------------

export const TimelineEventSchema = Type.Object({
  at: DateTimeSchema,
  /** created, updated, item_added, item_removed, schema_draft_saved, scheduled, unscheduled, shipping,
   * shipped, failed, discarded, item.changedAfterReview, deploy_triggered, deploy_building, deploy_deployed, deploy_failed. */
  kind: Type.String(),
  actor: Nullable(ActorSchema),
  message: NullableString,
  snapshot: NullableInteger,
  deploymentRunId: Nullable(UuidSchema),
  /** `item.changedAfterReview`: the entry whose draft moved between review and a scheduled ship. */
  item: Nullable(
    Type.Object({
      entryId: UuidSchema,
      locale: Type.String(),
      fromVersion: Type.Integer(),
      toVersion: Type.Integer(),
    }),
  ),
});
export const getTimelineSchema = {
  params: IdParamsSchema,
  response: { 200: Type.Object({ items: Type.Array(TimelineEventSchema) }), ...errors },
};

// Unassigned work -----------------------------------------------------------------------------------

export const UnassignedEntrySchema = Type.Object({
  entryId: UuidSchema,
  modelId: UuidSchema,
  modelKey: NullableString,
  title: NullableString,
  locale: Type.String(),
  /** `draft`: never published; `modified`: the draft differs from the live version. */
  status: Type.Enum(['draft', 'modified']),
  updatedAt: DateTimeSchema,
});
export const ListUnassignedQuerySchema = Type.Object(CursorQueryFields, { additionalProperties: false });
export type ListUnassignedQuery = Static<typeof ListUnassignedQuerySchema>;
export const listUnassignedSchema = {
  querystring: ListUnassignedQuerySchema,
  response: { 200: PageSchema(UnassignedEntrySchema), ...errors },
};
