/**
 * Admin identity API shapes (package B, build plan §4.B), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/** and routes/schemas/adminIdentity.ts. JSON is camelCase; timestamps are ISO-8601.
 */

export type AdminUserStatus = 'active' | 'disabled';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  status: AdminUserStatus;
  roleIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish', 'schemaManage'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** Actions not scoped to a model (instance administration). */
export const GLOBAL_ACTIONS = [
  'schema.create',
  'users.manage',
  'roles.manage',
  'tokens.manage',
  'audit.read',
  'media.read',
  'media.write',
  'media.manage',
  'publishing.manage',
  'webhooks.manage',
  'deployments.manage',
  'deployments.trigger',
  'changes.manage',
] as const;
export type GlobalAction = (typeof GLOBAL_ACTIONS)[number];

export type PermissionAction = ContentAction | GlobalAction;

export type RoleSummary = { id: string; key: string; name: string };

/** Returned whenever a session starts (setup, login, accepting an invitation). */
export type SessionStarted = { user: AdminUser; csrfToken: string };

export type MeResponse = {
  user: AdminUser;
  roles: RoleSummary[];
  globalPermissions: GlobalAction[];
  /** Content actions per model ID (models without any action are left out). */
  modelPermissions: Record<string, ContentAction[]>;
  /** How the server sends email: `console` writes it to the server log (no real delivery is set up). */
  emailDelivery: EmailDelivery;
  csrfToken: string;
};

export type EmailDelivery = 'console' | 'smtp';

export type SetupStatusResponse = {
  /** No admin exists yet. */
  required: boolean;
  /** SETUP_REQUIRE_TOKEN is set: setup also needs the one-time token from the server log. */
  requiresToken: boolean;
};

/** `token` is needed only when the server requires it (`requiresToken`); otherwise it is ignored. */
export type SetupInput = { token?: string; email: string; name: string; password: string };

export type LoginInput = { email: string; password: string };

export type CsrfResponse = { csrfToken: string };

export type UpdateProfileInput = { name: string };

export type ChangePasswordInput = { currentPassword: string; newPassword: string };

export type PasswordResetRequestInput = { email: string };

export type PasswordResetConfirmInput = { token: string; password: string };

export type AcceptInvitationInput = { token: string; name: string; password: string };

export type InspectInvitationResponse = { email: string; expiresAt: string };

export type AdminSession = {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type Invitation = {
  id: string;
  email: string;
  roleIds: string[];
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
};

/** A fresh accept link, shown once; issuing it makes earlier links (emailed or copied) stop working. */
export type InvitationLink = { acceptUrl: string; expiresAt: string };

export type InviteUserInput = { email: string; roleIds: string[] };

export type UpdateAdminUserInput = { name?: string; status?: AdminUserStatus; roleIds?: string[] };

export type RoleKind = 'admin' | 'delivery';

export type RoleCondition = 'ownedByPrincipal';

export type RolePermission = {
  action: PermissionAction;
  /** `null` grants the action on every model (and is required for global actions). */
  modelId: string | null;
  condition: RoleCondition | null;
  /** `null` = every field; otherwise only these stable field IDs. */
  fieldIds: string[] | null;
};

export type Role = {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: RoleKind;
  isSystem: boolean;
  /** Optimistic-concurrency version: send it back as `expectedVersion` on update. */
  version: number;
  permissions: RolePermission[];
  createdAt: string;
  updatedAt: string;
};

export type CreateRoleInput = {
  key: string;
  name: string;
  description?: string;
  kind?: RoleKind;
  permissions: RolePermission[];
};

export type UpdateRoleInput = {
  expectedVersion: number;
  name?: string;
  description?: string;
  permissions?: RolePermission[];
};

export type ApiToken = {
  id: string;
  name: string;
  /** First characters of the token (`shp_` + 6), for telling tokens apart. */
  tokenPrefix: string;
  roleId: string;
  scope: RoleKind;
  createdBy: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateApiTokenInput = { name: string; roleId: string; expiresAt?: string | null };

/** `token` is the plain secret, returned once at creation and never again. */
export type CreatedApiToken = { token: string; apiToken: ApiToken };

export type AuditActorType = 'admin' | 'app_user' | 'token' | 'anonymous' | 'system';

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorType: AuditActorType;
  actorId: string | null;
  /** The acting admin's (or app user's) display name, when the actor is a known account. */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: 'success' | 'failure';
  requestId: string | null;
  ip: string | null;
  metadata: unknown;
};

/** Newest first, cursor-paginated. */
export type AuditQuery = {
  cursor?: string;
  limit?: number;
  actorType?: AuditActorType;
  actorId?: string;
  action?: string;
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'failure';
  from?: string;
  to?: string;
};

export type AuditPage = { items: AuditEvent[]; nextCursor: string | null };
