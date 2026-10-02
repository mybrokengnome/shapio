import { Type, type Static } from 'typebox';
import { DateTimeSchema, IdParamsSchema, PermissionSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const RoleKindSchema = Type.Union([Type.Literal('admin'), Type.Literal('delivery')]);
const PermissionsSchema = Type.Array(PermissionSchema, { maxItems: 2000 });

const RoleSchema = Type.Object({
  id: UuidSchema,
  key: Type.String(),
  name: Type.String(),
  description: Type.String(),
  kind: RoleKindSchema,
  isSystem: Type.Boolean(),
  version: Type.Integer(),
  permissions: PermissionsSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const listRolesSchema = { response: { 200: Type.Array(RoleSchema) } };
export const getRoleSchema = { params: IdParamsSchema, response: { 200: RoleSchema } };

export const CreateRoleBodySchema = Type.Object(
  {
    key: Type.String({ pattern: '^[a-z][a-z0-9-]{0,62}$' }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    kind: Type.Optional(RoleKindSchema),
    permissions: PermissionsSchema,
  },
  { additionalProperties: false },
);
export type CreateRoleBody = Static<typeof CreateRoleBodySchema>;

export const createRoleSchema = {
  body: CreateRoleBodySchema,
  response: { 201: RoleSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};

export const UpdateRoleBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    permissions: Type.Optional(PermissionsSchema),
  },
  { additionalProperties: false },
);
export type UpdateRoleBody = Static<typeof UpdateRoleBodySchema>;

export const updateRoleSchema = {
  params: IdParamsSchema,
  body: UpdateRoleBodySchema,
  response: { 200: RoleSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};

export const deleteRoleSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 409: ErrorResponseSchema },
};
