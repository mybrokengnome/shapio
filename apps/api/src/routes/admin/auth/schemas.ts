import { Type, type Static } from 'typebox';
import {
  AdminUserSchema,
  ContentActionSchema,
  DateTimeSchema,
  EmailSchema,
  GlobalActionSchema,
  IdParamsSchema,
  NetworkActionSchema,
  OneTimeTokenSchema,
  PasswordAttemptSchema,
  PasswordSchema,
  PersonNameSchema,
  SessionStartedSchema,
  SiteActionSchema,
  UuidSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import { SiteSummarySchema } from '../sites/schemas.js';

const CsrfTokenSchema = Type.Object({ csrfToken: Type.String() });

export const LoginBodySchema = Type.Object(
  { email: Type.String({ minLength: 1, maxLength: 254 }), password: PasswordAttemptSchema },
  { additionalProperties: false },
);
export type LoginBody = Static<typeof LoginBodySchema>;

export const loginSchema = {
  body: LoginBodySchema,
  response: { 200: SessionStartedSchema, 401: ErrorResponseSchema, 429: ErrorResponseSchema },
};

export const logoutSchema = { response: { 204: Type.Null() } };

export const getMeSchema = {
  response: {
    200: Type.Object({
      user: AdminUserSchema,
      roles: Type.Array(Type.Object({ id: UuidSchema, key: Type.String(), name: Type.String() })),
      /** The site this response is about (the request's site: `Shapio-Site`, else the primary site). */
      site: SiteSummarySchema,
      /** Every site this admin holds a role on (all sites for a role assigned on every site). */
      sites: Type.Array(SiteSummarySchema),
      /** Network actions (roles assigned on every site only). */
      networkPermissions: Type.Array(NetworkActionSchema),
      /** Site actions on the request's site. */
      sitePermissions: Type.Array(SiteActionSchema),
      /** `networkPermissions` and `sitePermissions` together, for screens that do not distinguish them. */
      globalPermissions: Type.Array(GlobalActionSchema),
      /** Content actions per model ID on the request's site (models with none are left out). */
      modelPermissions: Type.Record(Type.String(), Type.Array(ContentActionSchema)),
      emailDelivery: Type.Union([Type.Literal('console'), Type.Literal('smtp')]),
      csrfToken: Type.String(),
    }),
  },
};

export const UpdateMeBodySchema = Type.Object({ name: PersonNameSchema }, { additionalProperties: false });
export type UpdateMeBody = Static<typeof UpdateMeBodySchema>;

export const updateMeSchema = { body: UpdateMeBodySchema, response: { 200: AdminUserSchema } };

export const ChangePasswordBodySchema = Type.Object(
  { currentPassword: PasswordAttemptSchema, newPassword: PasswordSchema },
  { additionalProperties: false },
);
export type ChangePasswordBody = Static<typeof ChangePasswordBodySchema>;

export const changePasswordSchema = {
  body: ChangePasswordBodySchema,
  response: { 200: CsrfTokenSchema, 400: ErrorResponseSchema },
};

export const getCsrfSchema = { response: { 200: CsrfTokenSchema } };

export const listSessionsSchema = {
  response: {
    200: Type.Array(
      Type.Object({
        id: UuidSchema,
        current: Type.Boolean(),
        ip: Type.Union([Type.String(), Type.Null()]),
        userAgent: Type.Union([Type.String(), Type.Null()]),
        createdAt: DateTimeSchema,
        lastSeenAt: DateTimeSchema,
        expiresAt: DateTimeSchema,
      }),
    ),
  },
};

export const revokeSessionSchema = { params: IdParamsSchema, response: { 204: Type.Null() } };

export const RequestResetBodySchema = Type.Object({ email: EmailSchema }, { additionalProperties: false });
export type RequestResetBody = Static<typeof RequestResetBodySchema>;

export const requestResetSchema = {
  body: RequestResetBodySchema,
  response: { 202: Type.Object({}), 429: ErrorResponseSchema },
};

export const ConfirmResetBodySchema = Type.Object(
  { token: OneTimeTokenSchema, password: PasswordSchema },
  { additionalProperties: false },
);
export type ConfirmResetBody = Static<typeof ConfirmResetBodySchema>;

export const confirmResetSchema = {
  body: ConfirmResetBodySchema,
  response: { 204: Type.Null(), 400: ErrorResponseSchema },
};
