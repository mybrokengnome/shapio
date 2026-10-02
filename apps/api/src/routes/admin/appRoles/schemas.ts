import { Type, type Static } from 'typebox';
import { APP_CONTENT_ACTIONS } from '../../../permissions/appRoles.js';
import { DateTimeSchema, IdParamsSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const closed = { additionalProperties: false } as const;

/** The admin-role grant shape (routes/schemas/adminIdentity.ts), limited to content actions. */
export const AppPermissionSchema = Type.Object(
  {
    action: Type.Enum(APP_CONTENT_ACTIONS),
    modelId: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    condition: Type.Union([Type.Literal('ownedByPrincipal'), Type.Null()]),
    fieldIds: Type.Union([
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 500 }),
      Type.Null(),
    ]),
  },
  closed,
);
const PermissionsSchema = Type.Array(AppPermissionSchema, { maxItems: 2000 });

const AppRoleSchema = Type.Object({
  id: UuidSchema,
  key: Type.String(),
  name: Type.String(),
  description: Type.String(),
  isSystem: Type.Boolean(),
  version: Type.Integer(),
  permissions: PermissionsSchema,
  userCount: Type.Integer(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const listAppRolesSchema = { response: { 200: Type.Array(AppRoleSchema) } };
export const getAppRoleSchema = {
  params: IdParamsSchema,
  response: { 200: AppRoleSchema, 404: ErrorResponseSchema },
};

export const CreateAppRoleBodySchema = Type.Object(
  {
    key: Type.String({ pattern: '^[a-z][a-z0-9-]{0,62}$' }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    permissions: PermissionsSchema,
  },
  closed,
);
export type CreateAppRoleBody = Static<typeof CreateAppRoleBodySchema>;

export const createAppRoleSchema = {
  body: CreateAppRoleBodySchema,
  response: { 201: AppRoleSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};

export const UpdateAppRoleBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    permissions: Type.Optional(PermissionsSchema),
  },
  closed,
);
export type UpdateAppRoleBody = Static<typeof UpdateAppRoleBodySchema>;

export const updateAppRoleSchema = {
  params: IdParamsSchema,
  body: UpdateAppRoleBodySchema,
  response: {
    200: AppRoleSchema,
    400: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
  },
};

export const deleteAppRoleSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};
