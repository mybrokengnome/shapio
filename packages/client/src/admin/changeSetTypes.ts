import type { DataType, SchemaDefinition } from '@shapio/schema';
import type { DeploymentRunStatus, Page, PublicationAction } from './publishingTypes.js';
import type { ChangePlan, DefinitionCategory, DefinitionPayload, PlanImpact } from './schemaTypes.js';
import type { SiteRef } from './sitesTypes.js';

/**
 * Change sets and snapshots (developer-face plan §5), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/{changeSets,snapshots}/schemas.ts. Dates are ISO-8601 strings.
 */

export const CHANGE_SET_STATUSES = [
  'open',
  'scheduled',
  'shipping',
  'shipped',
  'failed',
  'discarded',
] as const;
export type ChangeSetStatus = (typeof CHANGE_SET_STATUSES)[number];
/** While `shipping`: preparing (prerequisite dry runs, index builds) or activating (the final transaction). */
export type ShipPhase = 'preparing' | 'activating';
export type ChangeSetSource = 'manual' | 'release' | 'restore' | 'builder' | 'assist';
export type ChangeSetItemStatus = 'pending' | 'done' | 'failed';
export type SchemaOperation = 'create' | 'update' | 'delete';

export type ChangeSetActor = { type: 'admin' | 'token' | 'system'; id: string | null; name: string | null };

/** Why a ship failed, and the item that stopped it (null when not tied to one item). */
export type ChangeSetError = { code: string; message: string; itemId: string | null; details?: unknown };

export type ChangeSetEntryItem = {
  id: string;
  kind: 'entry';
  position: number;
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  action: PublicationAction;
  /** Restore items publish this exact revision instead of the current draft. */
  sourceRevisionId: string | null;
  status: ChangeSetItemStatus;
  error: string | null;
};

export type ChangeSetSchemaItem = {
  id: string;
  kind: 'schema';
  position: number;
  draftId: string;
  definitionId: string;
  category: DefinitionCategory;
  apiKey: string;
  operation: SchemaOperation;
  /** The active version the draft was based on; null for a new definition. */
  baseVersion: number | null;
  draftVersion: number;
  status: ChangeSetItemStatus;
  error: string | null;
};

export type ChangeSetItem = ChangeSetEntryItem | ChangeSetSchemaItem;

export type ChangeSetSummary = {
  id: string;
  title: string;
  description: string;
  status: ChangeSetStatus;
  shipPhase: ShipPhase | null;
  source: ChangeSetSource;
  restoreOfSnapshot: number | null;
  scheduledFor: string | null;
  /** Connection whose deploy is triggered (pinned to the shipped snapshot) after the set ships. */
  deploymentConnectionId: string | null;
  deploymentRunId: string | null;
  shippedAt: string | null;
  /** The publication snapshot the set went live in. */
  shippedSnapshot: number | null;
  schemaVersionAfter: number | null;
  error: ChangeSetError | null;
  entryItemCount: number;
  schemaItemCount: number;
  createdBy: ChangeSetActor;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ChangeSet = ChangeSetSummary & { items: ChangeSetItem[] };

export type ChangeSetQuery = {
  /** Comma-separated statuses; default: everything except `discarded`. */
  status?: string;
  cursor?: string;
  limit?: number;
};

export type CreateChangeSetInput = {
  title: string;
  description?: string;
  /** `builder`: a one-item set the model builder ships at once ("Review & ship now"). Default `manual`. */
  source?: 'manual' | 'builder';
};
export type UpdateChangeSetInput = {
  title?: string;
  description?: string;
  deploymentConnectionId?: string | null;
  expectedVersion: number;
};
export type AddChangeSetEntryInput = {
  modelKey: string;
  entryId: string;
  /** Omit for non-localized models (and for the default locale). */
  locale?: string;
  action: PublicationAction;
};

export type SchemaDraft = {
  id: string;
  changeSetId: string;
  definitionId: string;
  category: DefinitionCategory;
  operation: SchemaOperation;
  baseVersion: number | null;
  /** Null when the draft deletes the definition. */
  definition: SchemaDefinition | null;
  /** A new definition the draft creates shared with all sites (otherwise it belongs to the set's site). */
  shared: boolean;
  version: number;
  updatedBy: ChangeSetActor;
  createdAt: string;
  updatedAt: string;
};

export type PutSchemaDraftInput = {
  category: DefinitionCategory;
  /** The whole proposed definition, or null to delete the definition when the set ships. */
  definition: DefinitionPayload | null;
  /** The active version the edit is based on (null: a new definition). */
  baseVersion: number | null;
  /** For a new definition: create it shared with all sites (default false: the set's site). */
  shared?: boolean;
  /** The draft row version the caller saw; omit when creating the draft. */
  expectedDraftVersion?: number;
};

/**
 * One changed field. `summary` is the server's readable form of each side (rich text as its text, media as
 * filenames, relations as titles, components as labelled items); null when that side is empty.
 */
export type FieldDiff = {
  fieldId: string;
  apiKey: string;
  label: string;
  type: DataType;
  before: unknown;
  after: unknown;
  summary: { before: string | null; after: string | null };
};
export type ReviewIssue = { path: string; code: string; message: string };

export type ReviewEntryItem = {
  itemId: string;
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  action: PublicationAction;
  sourceRevisionId: string | null;
  /** Send back in `ship.itemVersions` (strict ship). Null when the item does not publish the draft. */
  draftVersion: number | null;
  liveState: 'unpublished' | 'published' | 'modified' | 'missing';
  fields: FieldDiff[];
  issues: ReviewIssue[];
};

export type ReviewSchemaItem = {
  itemId: string;
  draftId: string;
  definitionId: string;
  category: DefinitionCategory;
  apiKey: string;
  operation: SchemaOperation;
  baseVersion: number | null;
  activeVersion: number | null;
  /** The active version moved since the draft was based on it: shipping refuses until it is rebased. */
  stale: boolean;
  plan: ChangePlan | null;
  impact: PlanImpact | null;
  /** Entries of the affected models per site (a shared definition converts every site's content). */
  affectedEntriesBySite: Array<{ site: SiteRef; entries: number }>;
  issues: ReviewIssue[];
  alsoChangedIn: Array<{ id: string; title: string }>;
};

export const NOT_RESTORABLE_REASONS = [
  'entry_deleted',
  'model_missing',
  'publishing_disabled',
  'localization_changed',
  'locale_missing',
  'invalid',
  'unique_conflict',
] as const;
export type NotRestorableReason = (typeof NOT_RESTORABLE_REASONS)[number];

export type NotRestorable = {
  entryId: string;
  modelId: string;
  modelKey: string | null;
  locale: string;
  reason: NotRestorableReason;
  detail: string;
};

export type FieldConsumer = {
  /** The site the reads were made on. */
  site: SiteRef;
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  label: string | null;
  reads: number;
  lastReadAt: string | null;
  /** `implicit`: the reader requested the whole model (no field selection). */
  selection: 'explicit' | 'implicit';
};

export type FieldConsumers = {
  modelId: string;
  fieldId: string;
  apiKey: string;
  consumers: FieldConsumer[];
  /**
   * Readers on other sites, as totals, when the viewer holds no role on every site; null when the viewer
   * sees every site's readers in `consumers`.
   */
  otherSites: { consumers: number; reads: number } | null;
};

export type ChangeSetReview = {
  changeSet: ChangeSet;
  entries: ReviewEntryItem[];
  schema: ReviewSchemaItem[];
  notRestorable: NotRestorable[];
  consumers: FieldConsumers[];
  usageDays: number;
  checks: { breaking: boolean; destructive: boolean; blocking: ReviewIssue[]; warnings: ReviewIssue[] };
  /** Fixed notices, e.g. `NEW_FIELDS_AFTER_SHIP`. */
  notices: string[];
};

export type ShipChangeSetInput = {
  expectedVersion: number;
  acknowledgeBreaking?: boolean;
  acknowledgeDestructive?: boolean;
  /** Draft versions the review showed; a moved draft makes the ship refuse with 409 CHANGE_SET_STALE. */
  itemVersions?: Array<{ itemId: string; draftVersion: number }>;
};

export type ScheduleChangeSetInput = {
  at: string;
  expectedVersion: number;
  acknowledgeBreaking?: boolean;
  acknowledgeDestructive?: boolean;
};

export type ChangeSetTimelineEvent = {
  at: string;
  kind: string;
  actor: ChangeSetActor | null;
  message: string | null;
  snapshot: number | null;
  deploymentRunId: string | null;
  /** `item.changedAfterReview`: the entry whose draft moved between review and a scheduled ship. */
  item: { entryId: string; locale: string; fromVersion: number; toVersion: number } | null;
};

export type UnassignedEntry = {
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  status: 'draft' | 'modified';
  updatedAt: string;
};

// Snapshots ----------------------------------------------------------------------------------------

export const SNAPSHOT_SOURCES = [
  'publish',
  'unpublish',
  'delete',
  'schedule',
  'change_set',
  'schema',
  'conversion',
  'import',
  'legacy',
] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export type Snapshot = {
  seq: number;
  schemaVersion: number | null;
  source: SnapshotSource;
  changeSetId: string | null;
  changeSetTitle: string | null;
  actor: { type: string; id: string | null };
  changedEntries: number;
  deploymentRuns: Array<{ id: string; connectionId: string; status: DeploymentRunStatus }>;
  createdAt: string;
};

export type SnapshotPage = Page<Snapshot> & { current: number };
export type SnapshotQuery = { cursor?: string; limit?: number };
