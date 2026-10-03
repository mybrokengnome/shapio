import { Type, type Static } from 'typebox';
import { DateTimeSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import {
  CursorQueryFields,
  Nullable,
  NullableInteger,
  NullableString,
  PageSchema,
} from '../../schemas/publishing.js';
import { ChangeSetSchema } from '../changeSets/schemas.js';

/**
 * /api/admin/snapshots: the publication snapshot ledger (`publication_snapshots`), one row per snapshot
 * number, and restore (a new change set that brings live content back to snapshot N).
 */
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

export const SnapshotSchema = Type.Object({
  seq: Type.Integer(),
  /** The global schema version live right after this snapshot; null for snapshots older than the ledger. */
  schemaVersion: NullableInteger,
  source: Type.Enum(SNAPSHOT_SOURCES),
  changeSetId: Nullable(UuidSchema),
  changeSetTitle: NullableString,
  /** The change set that took the number, with its site (another site's set when it converted content here). */
  changeSet: Nullable(
    Type.Object({
      id: UuidSchema,
      title: Type.String(),
      site: Type.Object({ id: UuidSchema, key: Type.String() }),
    }),
  ),
  actor: Type.Object({ type: Type.String(), id: NullableString }),
  /** (entry, locale) publications that started or ended at this snapshot. */
  changedEntries: Type.Integer(),
  deploymentRuns: Type.Array(
    Type.Object({ id: UuidSchema, connectionId: UuidSchema, status: Type.String() }),
  ),
  createdAt: DateTimeSchema,
});

export const ListSnapshotsQuerySchema = Type.Object(CursorQueryFields, { additionalProperties: false });
export type ListSnapshotsQuery = Static<typeof ListSnapshotsQuerySchema>;

const errors = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  422: ErrorResponseSchema,
};

export const listSnapshotsSchema = {
  querystring: ListSnapshotsQuerySchema,
  response: {
    200: Type.Object({
      ...PageSchema(SnapshotSchema).properties,
      /** The newest snapshot number (`publication_state.last_seq`). */
      current: Type.Integer(),
    }),
    ...errors,
  },
};

export const SeqParamsSchema = Type.Object({ seq: Type.Integer({ minimum: 0 }) });
export type SeqParams = Static<typeof SeqParamsSchema>;

export const getSnapshotSchema = { params: SeqParamsSchema, response: { 200: SnapshotSchema, ...errors } };

/** 201: the new restore change set (open, reviewable); nothing goes live until it ships. */
export const restoreSnapshotSchema = {
  params: SeqParamsSchema,
  response: { 201: ChangeSetSchema, ...errors },
};
