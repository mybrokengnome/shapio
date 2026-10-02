/**
 * Principals and policies (ADR 0005). One evaluator serves admin users, app users, tokens and anonymous
 * callers, for REST and GraphQL alike. Package A ships the types and a deny-all evaluator; package B
 * implements roles and the real evaluator against this interface.
 */

export type AdminPrincipal = {
  kind: 'admin';
  adminUserId: string;
  sessionId: string;
  roleIds: readonly string[];
};

export type AppUserPrincipal = {
  kind: 'appUser';
  appUserId: string;
  roleIds: readonly string[];
};

/** API tokens bind to exactly one role: an admin role or a delivery role. */
export type TokenPrincipal = {
  kind: 'token';
  tokenId: string;
  scope: 'admin' | 'delivery';
  roleId: string;
};

export type AnonymousPrincipal = { kind: 'anonymous' };

/** Work Shapio does on its own behalf: scheduled jobs, migrations, the worker. Never derived from a request. */
export type SystemPrincipal = { kind: 'system'; component: string };

export type Principal =
  AdminPrincipal | AppUserPrincipal | TokenPrincipal | AnonymousPrincipal | SystemPrincipal;

export const CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish', 'schemaManage'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/**
 * Actions that are not scoped to one model: creating a model has no model to grant on, and managing admin
 * users, roles, API tokens, reading the audit log and the media library are about the instance, not one model.
 */
export const GLOBAL_ACTIONS = [
  'schema.create',
  'users.manage',
  'roles.manage',
  'tokens.manage',
  'audit.read',
  // Media library (package G): browse; upload, edit and organise; delete and change visibility.
  'media.read',
  'media.write',
  'media.manage',
  // Publishing (package H): the jobs view and scheduling overview; webhooks; deployment connections;
  // triggering and retrying deployment runs; change sets (schema + content shipped as one snapshot).
  'publishing.manage',
  'webhooks.manage',
  'deployments.manage',
  'deployments.trigger',
  'changes.manage',
] as const;
export type GlobalAction = (typeof GLOBAL_ACTIONS)[number];

/** Field visibility by stable field ID. `all` means every field the schema exposes to this principal kind. */
export type FieldMask = { mode: 'all' } | { mode: 'only'; fieldIds: readonly string[] };

/** Enumerated row conditions; compiled to SQL only by content/compiler. Never free-form expressions. */
export type RowCondition = { kind: 'ownedByPrincipal' };

export type RowFilter =
  | RowCondition
  | { kind: 'and'; filters: readonly RowFilter[] }
  | { kind: 'or'; filters: readonly RowFilter[] };

export type Policy = {
  allowed: boolean;
  /** Extra restriction on which rows the principal may act on. `null` means no restriction. */
  rowFilter: RowFilter | null;
  readMask: FieldMask;
  writeMask: FieldMask;
};

export type PolicyRequest = {
  action: ContentAction;
  modelId: string;
};

export type PermissionEvaluator = {
  evaluate: (principal: Principal, request: PolicyRequest) => Promise<Policy>;
  canPerform: (principal: Principal, action: GlobalAction) => Promise<boolean>;
};

const EMPTY_MASK: FieldMask = { mode: 'only', fieldIds: [] };

export const DENIED_POLICY: Policy = Object.freeze({
  allowed: false,
  rowFilter: null,
  readMask: EMPTY_MASK,
  writeMask: EMPTY_MASK,
});
