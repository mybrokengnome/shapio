import { Type, type Static } from 'typebox';
import { DateTimeInputSchema, DateTimeSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const ShortText = Type.String({ minLength: 1, maxLength: 200 });

export const ListAuditQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 500 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    actorType: Type.Optional(Type.Enum(['admin', 'app_user', 'token', 'anonymous', 'system'])),
    actorId: Type.Optional(ShortText),
    action: Type.Optional(ShortText),
    actionPrefix: Type.Optional(ShortText),
    targetType: Type.Optional(ShortText),
    targetId: Type.Optional(ShortText),
    outcome: Type.Optional(Type.Union([Type.Literal('success'), Type.Literal('failure')])),
    from: Type.Optional(DateTimeInputSchema),
    to: Type.Optional(DateTimeInputSchema),
  },
  { additionalProperties: false },
);
export type ListAuditQuery = Static<typeof ListAuditQuerySchema>;

export const listAuditSchema = {
  querystring: ListAuditQuerySchema,
  response: {
    200: Type.Object({
      items: Type.Array(
        Type.Object({
          id: Type.String(),
          occurredAt: DateTimeSchema,
          actorType: Type.String(),
          actorId: Type.Union([Type.String(), Type.Null()]),
          actorName: Type.Union([Type.String(), Type.Null()]),
          actorEmail: Type.Union([Type.String(), Type.Null()]),
          action: Type.String(),
          targetType: Type.Union([Type.String(), Type.Null()]),
          targetId: Type.Union([Type.String(), Type.Null()]),
          outcome: Type.String(),
          requestId: Type.Union([Type.String(), Type.Null()]),
          ip: Type.Union([Type.String(), Type.Null()]),
          metadata: Type.Unknown(),
        }),
      ),
      nextCursor: Type.Union([Type.String(), Type.Null()]),
    }),
    400: ErrorResponseSchema,
  },
};
