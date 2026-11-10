import { Type, type Static } from 'typebox';
import {
  DateTimeInputSchema,
  DateTimeSchema,
  IdParamsSchema,
  NullableDateTimeSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const ApiTokenSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  tokenPrefix: Type.String(),
  roleId: UuidSchema,
  scope: Type.Union([Type.Literal('admin'), Type.Literal('delivery')]),
  /** The token's site; null for a network admin token (its role applies on every site). */
  siteId: Type.Union([UuidSchema, Type.Null()]),
  createdBy: Type.Union([UuidSchema, Type.Null()]),
  /** The creator's account is disabled: the token is refused until it is enabled again. */
  creatorDisabled: Type.Boolean(),
  expiresAt: NullableDateTimeSchema,
  lastUsedAt: NullableDateTimeSchema,
  revokedAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
  /**
   * The schema version the token is pinned to: a request made with it that names no schema version is served
   * as if it had named this one. Null: today's shape.
   */
  pinnedSchemaVersion: Type.Union([Type.Integer(), Type.Null()]),
  /** False when the history does not reach the pin for some definition: those reads answer 409. */
  pinnedSchemaVersionAvailable: Type.Boolean(),
});

/**
 * A schema version to pin the token to, or null for none. Any number is accepted here so the service can
 * answer `INVALID_PINNED_SCHEMA_VERSION` (a whole number from 1 to the current schema version). One type
 * list rather than a union: Ajv's type coercion would turn null into 0 trying the number branch first.
 */
const PinnedSchemaVersionInputSchema = Type.Unsafe<number | null>({ type: ['number', 'null'] });

export const listTokensSchema = { response: { 200: Type.Array(ApiTokenSchema) } };

export const CreateTokenBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    roleId: UuidSchema,
    expiresAt: Type.Optional(Type.Union([DateTimeInputSchema, Type.Null()])),
    /**
     * A network admin token: its role applies on every site and to network actions. Needs `users.manage`.
     * Omitted or false: a token of the request's site.
     * Delivery tokens always belong to the request's site.
     */
    network: Type.Optional(Type.Boolean()),
    pinnedSchemaVersion: Type.Optional(PinnedSchemaVersionInputSchema),
  },
  { additionalProperties: false },
);
export type CreateTokenBody = Static<typeof CreateTokenBodySchema>;

export const UpdateTokenBodySchema = Type.Object(
  { pinnedSchemaVersion: PinnedSchemaVersionInputSchema },
  { additionalProperties: false },
);
export type UpdateTokenBody = Static<typeof UpdateTokenBodySchema>;

/** `token` is the only time the value is ever shown. */
export const createTokenSchema = {
  body: CreateTokenBodySchema,
  response: {
    201: Type.Object({ token: Type.String(), apiToken: ApiTokenSchema }),
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
  },
};

export const updateTokenSchema = {
  params: IdParamsSchema,
  body: UpdateTokenBodySchema,
  response: {
    200: ApiTokenSchema,
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
  },
};

export const revokeTokenSchema = { params: IdParamsSchema, response: { 204: Type.Null() } };
