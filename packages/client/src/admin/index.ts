import type { RequestFn } from '../request.js';
import { createAppUsersApi } from './appUsers.js';
import { createAssistApi } from './assist.js';
import { createChangeSetsApi } from './changeSets.js';
import { createContentApi } from './content.js';
import { createEditingApi } from './editing.js';
import { createMediaApi } from './media.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { createPublishingApi } from './publishing.js';
import { toQueryString } from './query.js';
import { createSchemaApi } from './schema.js';
import { createSitesApi } from './sites.js';
import type {
  AcceptInvitationInput,
  AdminSession,
  AdminUser,
  ApiToken,
  AuditPage,
  AuditQuery,
  ChangePasswordInput,
  CreateApiTokenInput,
  CreatedApiToken,
  CreateRoleInput,
  CsrfResponse,
  InspectInvitationResponse,
  Invitation,
  InvitationLink,
  InviteUserInput,
  LoginInput,
  MeResponse,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  Role,
  SessionStarted,
  SetupInput,
  SetupStatusResponse,
  UpdateAdminUserInput,
  UpdateProfileInput,
  UpdateRoleInput,
} from './types.js';
import { createUsageApi } from './usage.js';

/**
 * Admin endpoints: identity (setup, auth, sessions, users, invitations, roles, tokens, audit) and the schema
 * registry (models, components, schema, locales), the media library and content.
 */
export const createAdminApi = (request: RequestFn) => ({
  setup: {
    status: () => request<SetupStatusResponse>(ADMIN_PATHS.setup),
    complete: (body: SetupInput) => request<SessionStarted>(ADMIN_PATHS.setup, { method: 'POST', body }),
  },
  auth: {
    csrf: () => request<CsrfResponse>(ADMIN_PATHS.csrf),
    login: (body: LoginInput) => request<SessionStarted>(ADMIN_PATHS.login, { method: 'POST', body }),
    logout: () => request<void>(ADMIN_PATHS.logout, { method: 'POST' }),
    me: () => request<MeResponse>(ADMIN_PATHS.me),
    updateProfile: (body: UpdateProfileInput) =>
      request<AdminUser>(ADMIN_PATHS.me, { method: 'PATCH', body }),
    /** The session is rotated: the response carries the new session's CSRF token. */
    changePassword: (body: ChangePasswordInput) =>
      request<CsrfResponse>(ADMIN_PATHS.password, { method: 'POST', body }),
    requestPasswordReset: (body: PasswordResetRequestInput) =>
      request<void>(ADMIN_PATHS.passwordReset, { method: 'POST', body }),
    confirmPasswordReset: (body: PasswordResetConfirmInput) =>
      request<void>(ADMIN_PATHS.passwordResetConfirm, { method: 'POST', body }),
  },
  sessions: {
    list: () => request<AdminSession[]>(ADMIN_PATHS.sessions),
    revoke: (id: string) => request<void>(withId(ADMIN_PATHS.sessions, id), { method: 'DELETE' }),
  },
  users: {
    list: () => request<AdminUser[]>(ADMIN_PATHS.users),
    get: (id: string) => request<AdminUser>(withId(ADMIN_PATHS.users, id)),
    update: (id: string, body: UpdateAdminUserInput) =>
      request<AdminUser>(withId(ADMIN_PATHS.users, id), { method: 'PATCH', body }),
    remove: (id: string) => request<void>(withId(ADMIN_PATHS.users, id), { method: 'DELETE' }),
    revokeSessions: (id: string) =>
      request<void>(`${withId(ADMIN_PATHS.users, id)}/sessions`, { method: 'DELETE' }),
  },
  invitations: {
    list: () => request<Invitation[]>(ADMIN_PATHS.invitations),
    create: (body: InviteUserInput) => request<Invitation>(ADMIN_PATHS.invitations, { method: 'POST', body }),
    revoke: (id: string) => request<void>(withId(ADMIN_PATHS.invitations, id), { method: 'DELETE' }),
    /** A fresh link to send by hand; any earlier link for this invitation stops working. */
    link: (id: string) =>
      request<InvitationLink>(`${withId(ADMIN_PATHS.invitations, id)}/link`, { method: 'POST' }),
    /** Public: the token travels in the body, never in a URL the server logs. */
    inspect: (token: string) =>
      request<InspectInvitationResponse>(ADMIN_PATHS.inspectInvitation, { method: 'POST', body: { token } }),
    accept: (body: AcceptInvitationInput) =>
      request<SessionStarted>(ADMIN_PATHS.acceptInvitation, { method: 'POST', body }),
  },
  roles: {
    list: () => request<Role[]>(ADMIN_PATHS.roles),
    get: (id: string) => request<Role>(withId(ADMIN_PATHS.roles, id)),
    create: (body: CreateRoleInput) => request<Role>(ADMIN_PATHS.roles, { method: 'POST', body }),
    update: (id: string, body: UpdateRoleInput) =>
      request<Role>(withId(ADMIN_PATHS.roles, id), { method: 'PATCH', body }),
    remove: (id: string) => request<void>(withId(ADMIN_PATHS.roles, id), { method: 'DELETE' }),
  },
  tokens: {
    list: () => request<ApiToken[]>(ADMIN_PATHS.tokens),
    create: (body: CreateApiTokenInput) =>
      request<CreatedApiToken>(ADMIN_PATHS.tokens, { method: 'POST', body }),
    revoke: (id: string) => request<void>(withId(ADMIN_PATHS.tokens, id), { method: 'DELETE' }),
  },
  audit: {
    list: (query: AuditQuery = {}) => request<AuditPage>(`${ADMIN_PATHS.audit}${toQueryString(query)}`),
  },
  ...createSchemaApi(request),
  ...createMediaApi(request),
  ...createContentApi(request),
  ...createEditingApi(request),
  ...createPublishingApi(request),
  ...createAppUsersApi(request),
  ...createChangeSetsApi(request),
  ...createUsageApi(request),
  ...createSitesApi(request),
  ...createAssistApi(request),
});

export type AdminApi = ReturnType<typeof createAdminApi>;
export { ADMIN_PATHS } from './paths.js';
export * from './types.js';
export * from './schemaTypes.js';
export * from './schemaSyncTypes.js';
export * from './mediaTypes.js';
export * from './contentTypes.js';
export * from './publishingTypes.js';
export * from './appUsersTypes.js';
export * from './changeSetTypes.js';
export * from './usageTypes.js';
export * from './sitesTypes.js';
export { SITE_HEADER, SITES_PATHS } from './sites.js';
export { toContentQueryString } from './contentQuery.js';
export { buildUploadForm, resolveUploadUrl } from './media.js';
export { HEALTH_RULES } from './editingTypes.js';
export { ASSIST_PATHS } from './assist.js';
export { CONTENT_OPS_RULES } from './assistTypes.js';
