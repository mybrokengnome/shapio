import { Type, type Static } from 'typebox';
import {
  DateTimeSchema,
  IdParamsSchema,
  NullableDateTimeSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const closed = { additionalProperties: false } as const;

export const AdminAppUserSchema = Type.Object({
  id: UuidSchema,
  email: Type.String(),
  name: Type.String(),
  confirmed: Type.Boolean(),
  blocked: Type.Boolean(),
  hasPassword: Type.Boolean(),
  providers: Type.Array(Type.String()),
  roleIds: Type.Array(UuidSchema),
  lastLoginAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const ListAppUsersQuerySchema = Type.Object(
  {
    search: Type.Optional(Type.String({ maxLength: 200 })),
    cursor: Type.Optional(Type.String({ maxLength: 200 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  closed,
);
export type ListAppUsersQuery = Static<typeof ListAppUsersQuerySchema>;

export const listAppUsersSchema = {
  querystring: ListAppUsersQuerySchema,
  response: {
    200: Type.Object({
      items: Type.Array(AdminAppUserSchema),
      nextCursor: Type.Union([Type.String(), Type.Null()]),
    }),
    400: ErrorResponseSchema,
  },
};

export const getAppUserSchema = {
  params: IdParamsSchema,
  response: { 200: AdminAppUserSchema, 404: ErrorResponseSchema },
};

export const UpdateAppUserBodySchema = Type.Object(
  {
    blocked: Type.Optional(Type.Boolean()),
    roleIds: Type.Optional(Type.Array(UuidSchema, { maxItems: 100 })),
  },
  closed,
);
export type UpdateAppUserBody = Static<typeof UpdateAppUserBodySchema>;

export const updateAppUserSchema = {
  params: IdParamsSchema,
  body: UpdateAppUserBodySchema,
  response: { 200: AdminAppUserSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};

export const deleteAppUserSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 404: ErrorResponseSchema },
};

export const resendConfirmationSchema = {
  params: IdParamsSchema,
  response: { 202: Type.Null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};
