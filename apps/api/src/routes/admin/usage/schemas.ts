import { Type, type Static } from 'typebox';
import { DateTimeSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

export const FieldUsageQuerySchema = Type.Object(
  {
    modelId: UuidSchema,
    /** Days counted, today included (at most USAGE_RETENTION_DAYS are kept). */
    days: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
  },
  { additionalProperties: false },
);
export type FieldUsageQuery = Static<typeof FieldUsageQuerySchema>;

const PrincipalKey = Type.String({ description: '`token:<id>`, `app_users` or `anonymous`' });

const FieldPrincipalUsageSchema = Type.Object({
  principalKey: PrincipalKey,
  tokenName: Type.Optional(Type.String()),
  reads: Type.Integer(),
  lastReadAt: DateTimeSchema,
  /** `implicit`: every read asked for the whole model (no field selection). */
  selection: Type.Enum(['explicit', 'implicit']),
});

export const FieldUsageResponseSchema = Type.Object({
  /** USAGE_TRACKING: false means nothing new is being counted. */
  tracking: Type.Boolean(),
  modelId: UuidSchema,
  days: Type.Integer(),
  /** First day counted (UTC, `YYYY-MM-DD`). */
  since: Type.String(),
  fields: Type.Array(
    Type.Object({
      /** A field ID, or `<relation field ID>.<target field ID>` for a populated relation's field. */
      fieldPath: Type.String(),
      /** API keys along the path in the current schema; null when a field no longer exists. */
      apiKeyPath: Type.Union([Type.String(), Type.Null()]),
      reads: Type.Integer(),
      lastReadAt: DateTimeSchema,
      principals: Type.Array(FieldPrincipalUsageSchema),
    }),
  ),
  principals: Type.Array(
    Type.Object({
      principalKey: PrincipalKey,
      tokenName: Type.Optional(Type.String()),
      requests: Type.Integer(),
      lastReadAt: DateTimeSchema,
      /** The snapshot last pinned with `snapshot`; null when it reads live content. */
      lastSnapshot: Type.Union([Type.Integer(), Type.Null()]),
    }),
  ),
});

export const fieldUsageSchema = {
  querystring: FieldUsageQuerySchema,
  response: { 200: FieldUsageResponseSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};
