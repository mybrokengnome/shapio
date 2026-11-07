import type { SiteSummary } from './sitesTypes.js';
/**
 * Admin identity API shapes (package B, build plan §4.B), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/** and routes/schemas/adminIdentity.ts. JSON is camelCase; timestamps are ISO-8601.
 */

export type AdminUserStatus = 'active' | 'disabled';

/** A role held on one workspace, or on every workspace (`siteId` null). */
export type RoleAssignment = { roleId: string; siteId: string | null };

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  status: AdminUserStatus;
  /** Where each role applies. */
  assignments: RoleAssignment[];
  /** Deprecated: the distinct roles of `assignments`, on any workspace. */
  roleIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Usable API tokens this admin created: refused while the account is disabled, revoked when it is deleted. */
  apiTokens: AdminUserApiToken[];
};

/** An API token listed with the admin who created it. */
export type AdminUserApiToken = { id: string; name: string; siteId: string | null };

export const CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish', 'schemaManage'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/**
 * What a delivery role grants: `read`, and `readDrafts` (drafts mode: the token's workspace may read drafts with
 * `publicationState=draft`). `readDrafts` always covers every model and is never granted to admin roles.
 */
export const DELIVERY_ACTIONS = ['read', 'readDrafts'] as const;
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];

/**
 * Network actions: about the whole instance. Only roles assigned on every workspace grant them, so a role
 * held on one workspace never reaches the network.
 */
export const NETWORK_ACTIONS = [
  'schema.create',
  'users.manage',
  'roles.manage',
  'audit.read',
  'sites.manage',
] as const;
export type NetworkAction = (typeof NETWORK_ACTIONS)[number];

/** Workspace actions: about one workspace's library, tokens and publishing. */
export const SITE_ACTIONS = [
  'tokens.manage',
  'media.read',
  'media.write',
  'media.manage',
  'publishing.manage',
  'webhooks.manage',
  'deployments.manage',
  'deployments.trigger',
  'changes.manage',
  'changes.ship',
  'changes.approve',
] as const;
export type SiteAction = (typeof SITE_ACTIONS)[number];

/** Actions not scoped to a model: network actions and workspace actions. */
export const GLOBAL_ACTIONS = [
  'schema.create',
  'users.manage',
  'roles.manage',
  'tokens.manage',
  'audit.read',
  'sites.manage',
  'media.read',
  'media.write',
  'media.manage',
  'publishing.manage',
  'webhooks.manage',
  'deployments.manage',
  'deployments.trigger',
  'changes.manage',
  'changes.ship',
  'changes.approve',
  'site.settings',
] as const;
export type GlobalAction = (typeof GLOBAL_ACTIONS)[number];

export type PermissionAction = ContentAction | DeliveryAction | GlobalAction;

export type RoleSummary = { id: string; key: string; name: string };

/** Returned whenever a session starts (setup, login, accepting an invitation). */
export type SessionStarted = { user: AdminUser; csrfToken: string };

export type MeResponse = {
  user: AdminUser;
  roles: RoleSummary[];
  /** The workspace this response is about: the request's `Shapio-Site`, else the primary workspace. */
  site: SiteSummary;
  /** Every workspace this admin holds a role on (all of them for a role assigned on every workspace). */
  sites: SiteSummary[];
  /**
   * Workspaces on this instance (whether or not the admin holds a role on them); scope is shown only above 1.
   */
  siteCount: number;
  /** Network actions (roles assigned on every workspace only). */
  networkPermissions: NetworkAction[];
  /**
   * Workspace actions on the request's workspace, plus `schema.create` when a role on the workspace grants it
   * for the workspace's own definitions (`networkPermissions` lists it when shared definitions may be created too).
   */
  sitePermissions: Array<SiteAction | 'schema.create'>;
  /** `networkPermissions` and `sitePermissions` together. */
  globalPermissions: GlobalAction[];
  /** Content actions per model ID on the request's site (models without any action are left out). */
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

/**
 * `token` is needed only when the server requires it (`requiresToken`); otherwise it is ignored. `workspaceName`
 * names the built-in workspace (server 0.8.2 or later; its key stays `default`); absent leaves its name.
 */
export type SetupInput = {
  token?: string;
  email: string;
  name: string;
  password: string;
  workspaceName?: string;
};

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
  /** The role assignments the invitee gets on accepting. */
  assignments: RoleAssignment[];
  /** Deprecated: the distinct roles of `assignments`. */
  roleIds: string[];
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
};

/** A fresh accept link, shown once; issuing it makes earlier links (emailed or copied) stop working. */
export type InvitationLink = { acceptUrl: string; expiresAt: string };

/**
 * Either `assignments` or (deprecated) `roleIds`, meaning those roles on every workspace; never both. Updating
 * either replaces every assignment.
 */
type AssignmentsInput =
  { assignments: RoleAssignment[]; roleIds?: never } | { roleIds: string[]; assignments?: never };

export type InviteUserInput = { email: string } & AssignmentsInput;

export type UpdateAdminUserInput = { name?: string; status?: AdminUserStatus } & (
  AssignmentsInput | { assignments?: never; roleIds?: never }
);

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
  /** The token's workspace; null for a network admin token (its role applies on every workspace). */
  siteId: string | null;
  createdBy: string | null;
  /** The creator's account is disabled: the token is refused until it is enabled again. */
  creatorDisabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateApiTokenInput = {
  name: string;
  roleId: string;
  expiresAt?: string | null;
  /**
   * A network admin token (every workspace and network actions; needs `users.manage`). Omitted: a network
   * token when the creator may create one, else a token of the request's workspace. Delivery tokens are
   * always per workspace.
   */
  network?: boolean;
};

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
