import { Type, type Static } from 'typebox';
import { NullableDateTimeSchema, UuidSchema } from '../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../schemas/error.js';

const SeqSchema = Type.Integer({ minimum: 0 });
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);
const ERRORS = { 400: ErrorResponseSchema, 401: ErrorResponseSchema };

export const SnapshotChangesQuerySchema = Type.Object(
  {
    from: SeqSchema,
    /** Defaults to the current snapshot. */
    to: Type.Optional(SeqSchema),
    /** `nextCursor` of the previous page. */
    after: Type.Optional(UuidSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
export type SnapshotChangesQuery = Static<typeof SnapshotChangesQuerySchema>;

export const SnapshotChangeSchema = Type.Object({
  id: UuidSchema,
  modelId: UuidSchema,
  modelKey: Type.String(),
  routeKey: Type.String(),
  /** From the revision live at `to` (at `from` when unpublished); null without a readable title. */
  title: Type.Union([Type.String(), Type.Null()]),
  /** The cover image's media asset ID, when the model has a readable cover. */
  coverMediaId: Type.Union([UuidSchema, Type.Null()]),
  locales: Type.Array(
    Type.Object({
      locale: Type.String(),
      change: Type.Enum(['published', 'updated', 'unpublished']),
      /** The revision live at `to`, or at `from` for `unpublished`. */
      revisionId: Type.Union([UuidSchema, Type.Null()]),
    }),
  ),
});

export const snapshotChangesSchema = {
  querystring: SnapshotChangesQuerySchema,
  response: {
    200: Type.Object({
      from: Type.Integer(),
      to: Type.Integer(),
      schemaVersions: Type.Object({ from: NullableInteger, to: NullableInteger }),
      items: Type.Array(SnapshotChangeSchema),
      nextCursor: Type.Union([UuidSchema, Type.Null()]),
    }),
    ...ERRORS,
  },
};

export const currentSnapshotSchema = {
  response: {
    200: Type.Object({
      snapshot: Type.Integer(),
      schemaVersion: Type.Integer(),
      publishedAt: NullableDateTimeSchema,
    }),
    ...ERRORS,
  },
};
