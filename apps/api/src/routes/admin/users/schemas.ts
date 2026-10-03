import { Type, type Static } from 'typebox';
import {
  AdminUserSchema,
  DateTimeSchema,
  EmailSchema,
  IdParamsSchema,
  OneTimeTokenSchema,
  PasswordSchema,
  PersonNameSchema,
  RoleAssignmentSchema,
  SessionStartedSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

/** Deprecated: these roles on every site. Send `assignments` instead (not both). */
const RoleIdsSchema = Type.Array(UuidSchema, { maxItems: 50 });
/** Every role assignment (replaces them all). */
const AssignmentsSchema = Type.Array(RoleAssignmentSchema, { maxItems: 200 });

export const listUsersSchema = { response: { 200: Type.Array(AdminUserSchema) } };
export const getUserSchema = { params: IdParamsSchema, response: { 200: AdminUserSchema } };

export const UpdateUserBodySchema = Type.Object(
  {
    name: Type.Optional(PersonNameSchema),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('disabled')])),
    roleIds: Type.Optional(RoleIdsSchema),
    assignments: Type.Optional(AssignmentsSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateUserBody = Static<typeof UpdateUserBodySchema>;

export const updateUserSchema = {
  params: IdParamsSchema,
  body: UpdateUserBodySchema,
  response: {
    200: AdminUserSchema,
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    409: ErrorResponseSchema,
  },
};

export const deleteUserSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 409: ErrorResponseSchema },
};
export const revokeUserSessionsSchema = { params: IdParamsSchema, response: { 204: Type.Null() } };

const InvitationSchema = Type.Object({
  id: UuidSchema,
  email: Type.String(),
  assignments: Type.Array(RoleAssignmentSchema),
  roleIds: Type.Array(UuidSchema),
  invitedBy: Type.Union([UuidSchema, Type.Null()]),
  expiresAt: DateTimeSchema,
  createdAt: DateTimeSchema,
});

export const listInvitationsSchema = { response: { 200: Type.Array(InvitationSchema) } };

/** `assignments` or (deprecated) `roleIds`: exactly one of them. */
export const CreateInvitationBodySchema = Type.Object(
  {
    email: EmailSchema,
    roleIds: Type.Optional(RoleIdsSchema),
    assignments: Type.Optional(AssignmentsSchema),
  },
  { additionalProperties: false },
);
export type CreateInvitationBody = Static<typeof CreateInvitationBodySchema>;

export const createInvitationSchema = {
  body: CreateInvitationBodySchema,
  response: { 201: InvitationSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};

export const revokeInvitationSchema = { params: IdParamsSchema, response: { 204: Type.Null() } };

export const invitationLinkSchema = {
  params: IdParamsSchema,
  response: {
    200: Type.Object({ acceptUrl: Type.String(), expiresAt: DateTimeSchema }),
    404: ErrorResponseSchema,
  },
};

export const InspectInvitationBodySchema = Type.Object(
  { token: OneTimeTokenSchema },
  { additionalProperties: false },
);
export type InspectInvitationBody = Static<typeof InspectInvitationBodySchema>;

export const inspectInvitationSchema = {
  body: InspectInvitationBodySchema,
  response: {
    200: Type.Object({ email: Type.String(), expiresAt: DateTimeSchema }),
    400: ErrorResponseSchema,
  },
};

export const AcceptInvitationBodySchema = Type.Object(
  { token: OneTimeTokenSchema, name: PersonNameSchema, password: PasswordSchema },
  { additionalProperties: false },
);
export type AcceptInvitationBody = Static<typeof AcceptInvitationBodySchema>;

export const acceptInvitationSchema = {
  body: AcceptInvitationBodySchema,
  response: { 201: SessionStartedSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};
