import { Type, type Static } from 'typebox';
import { APP_PASSWORD_MIN_LENGTH } from '../../constants/appAuth.js';
import { PASSWORD_MAX_LENGTH } from '../../constants/auth.js';
import {
  DateTimeSchema,
  EmailSchema,
  NullableDateTimeSchema,
  OneTimeTokenSchema,
  PasswordAttemptSchema,
  UuidSchema,
} from '../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../schemas/error.js';

/** Route schemas of the public app-user endpoints (/api/app-auth, package I). */

const closed = { additionalProperties: false } as const;

const AppPasswordSchema = Type.String({ minLength: APP_PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH });
const DisplayNameSchema = Type.String({ maxLength: 200 });
const ProviderSchema = Type.String({ pattern: '^[a-z]{1,20}$' });

export const AppUserSchema = Type.Object({
  id: UuidSchema,
  email: Type.String(),
  name: Type.String(),
  confirmed: Type.Boolean(),
  hasPassword: Type.Boolean(),
  providers: Type.Array(Type.String()),
  createdAt: DateTimeSchema,
  lastLoginAt: NullableDateTimeSchema,
});

export const AppSessionSchema = Type.Object({
  user: AppUserSchema,
  accessToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  expiresIn: Type.Integer(),
  refreshToken: Type.String(),
  refreshTokenExpiresAt: DateTimeSchema,
});

const errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  409: ErrorResponseSchema,
  429: ErrorResponseSchema,
};

export const RegisterBodySchema = Type.Object(
  { email: EmailSchema, password: AppPasswordSchema, name: Type.Optional(DisplayNameSchema) },
  closed,
);
export type RegisterBody = Static<typeof RegisterBodySchema>;
export const registerSchema = {
  body: RegisterBodySchema,
  response: {
    201: Type.Object({
      confirmationRequired: Type.Literal(false),
      user: AppUserSchema,
      session: AppSessionSchema,
    }),
    // Email confirmation is required: the same answer for a new and for an already registered address.
    202: Type.Object({ confirmationRequired: Type.Literal(true) }),
    ...errors,
  },
};

export const LoginBodySchema = Type.Object(
  { email: Type.String({ minLength: 1, maxLength: 254 }), password: PasswordAttemptSchema },
  closed,
);
export type LoginBody = Static<typeof LoginBodySchema>;
export const loginSchema = { body: LoginBodySchema, response: { 200: AppSessionSchema, ...errors } };

const RefreshTokenSchema = Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
export const RefreshBodySchema = Type.Object({ refreshToken: RefreshTokenSchema }, closed);
export type RefreshBody = Static<typeof RefreshBodySchema>;
export const refreshSchema = { body: RefreshBodySchema, response: { 200: AppSessionSchema, ...errors } };
export const logoutSchema = { body: RefreshBodySchema, response: { 204: Type.Null() } };

export const getMeSchema = { response: { 200: AppUserSchema, 401: ErrorResponseSchema } };

export const UpdateMeBodySchema = Type.Object({ name: DisplayNameSchema }, closed);
export type UpdateMeBody = Static<typeof UpdateMeBodySchema>;
export const updateMeSchema = { body: UpdateMeBodySchema, response: { 200: AppUserSchema, ...errors } };

export const ChangePasswordBodySchema = Type.Object(
  { currentPassword: Type.Optional(PasswordAttemptSchema), newPassword: AppPasswordSchema },
  closed,
);
export type ChangePasswordBody = Static<typeof ChangePasswordBodySchema>;
export const changePasswordSchema = {
  body: ChangePasswordBodySchema,
  response: { 200: AppSessionSchema, ...errors },
};

export const DeleteMeBodySchema = Type.Object({ password: Type.Optional(PasswordAttemptSchema) }, closed);
export type DeleteMeBody = Static<typeof DeleteMeBodySchema>;
export const deleteMeSchema = { body: DeleteMeBodySchema, response: { 204: Type.Null(), ...errors } };

export const TokenBodySchema = Type.Object({ token: OneTimeTokenSchema }, closed);
export type TokenBody = Static<typeof TokenBodySchema>;
export const confirmEmailSchema = { body: TokenBodySchema, response: { 204: Type.Null(), ...errors } };

export const EmailBodySchema = Type.Object({ email: EmailSchema }, closed);
export type EmailBody = Static<typeof EmailBodySchema>;
export const emailRequestSchema = { body: EmailBodySchema, response: { 202: Type.Null(), ...errors } };

export const ResetBodySchema = Type.Object(
  { token: OneTimeTokenSchema, password: AppPasswordSchema },
  closed,
);
export type ResetBody = Static<typeof ResetBodySchema>;
export const confirmResetSchema = { body: ResetBodySchema, response: { 204: Type.Null(), ...errors } };

export const providersSchema = {
  response: { 200: Type.Object({ providers: Type.Array(Type.String()) }) },
};

export const ProviderParamsSchema = Type.Object({ provider: ProviderSchema }, closed);
export type ProviderParams = Static<typeof ProviderParamsSchema>;

/** PKCE (RFC 7636): verifier 43–128 unreserved characters; S256 challenge = base64url(SHA-256), 43 chars. */
const CodeChallengeSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' });
const CodeVerifierSchema = Type.String({ minLength: 43, maxLength: 128, pattern: '^[A-Za-z0-9._~-]+$' });

export const OAuthStartQuerySchema = Type.Object(
  {
    redirectTo: Type.String({ minLength: 1, maxLength: 2000 }),
    /** S256 challenge of a verifier the app keeps; the code exchange must present that verifier. */
    codeChallenge: CodeChallengeSchema,
    /** Only S256 is accepted (`plain` would put the verifier itself in the URL). */
    codeChallengeMethod: Type.Optional(Type.Literal('S256')),
  },
  closed,
);
export type OAuthStartQuery = Static<typeof OAuthStartQuerySchema>;
export const oauthStartSchema = {
  params: ProviderParamsSchema,
  querystring: OAuthStartQuerySchema,
  response: { 302: Type.Null(), 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};

/** Whatever the provider sends back; unknown parameters (scope, authuser, prompt…) are ignored. */
export const OAuthCallbackQuerySchema = Type.Object({
  code: Type.Optional(Type.String({ maxLength: 2000 })),
  state: Type.Optional(Type.String({ maxLength: 200 })),
  error: Type.Optional(Type.String({ maxLength: 200 })),
});
export type OAuthCallbackQuery = Static<typeof OAuthCallbackQuerySchema>;
export const oauthCallbackSchema = {
  params: ProviderParamsSchema,
  querystring: OAuthCallbackQuerySchema,
  response: { 302: Type.Null(), 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};

export const ExchangeBodySchema = Type.Object(
  { code: OneTimeTokenSchema, codeVerifier: CodeVerifierSchema },
  closed,
);
export type ExchangeBody = Static<typeof ExchangeBodySchema>;
export const oauthExchangeSchema = {
  body: ExchangeBodySchema,
  response: { 200: AppSessionSchema, ...errors },
};
