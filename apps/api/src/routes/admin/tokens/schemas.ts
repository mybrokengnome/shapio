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
  expiresAt: NullableDateTimeSchema,
  lastUsedAt: NullableDateTimeSchema,
  revokedAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
});

export const listTokensSchema = { response: { 200: Type.Array(ApiTokenSchema) } };

export const CreateTokenBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    roleId: UuidSchema,
    expiresAt: Type.Optional(Type.Union([DateTimeInputSchema, Type.Null()])),
    /**
     * A network admin token: its role applies on every site and to network actions. Needs `users.manage`.
     * Omitted: a network token when the creator may create one, else a token of the request's site.
     * Delivery tokens always belong to the request's site.
     */
    network: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CreateTokenBody = Static<typeof CreateTokenBodySchema>;

/** `token` is the only time the value is ever shown. */
export const createTokenSchema = {
  body: CreateTokenBodySchema,
  response: {
    201: Type.Object({ token: Type.String(), apiToken: ApiTokenSchema }),
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
  },
};

export const revokeTokenSchema = { params: IdParamsSchema, response: { 204: Type.Null() } };
