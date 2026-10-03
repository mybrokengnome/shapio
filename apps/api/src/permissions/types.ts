/**
 * Principals and policies (ADR 0005). One evaluator serves admin users, app users, tokens and anonymous
 * callers, for REST and GraphQL alike. Package A ships the types and a deny-all evaluator; package B
 * implements roles and the real evaluator against this interface.
 */

/** One role held by an admin user: on one site, or on every site (`siteId` null). */
export type RoleAssignment = { roleId: string; siteId: string | null };

/**
 * An admin user as the session knows them: every role assignment, on any site. Never evaluated directly;
 * `narrowToSite` (permissions/sites.ts) turns it into the `AdminPrincipal` of one request's site.
 */
export type AdminIdentity = {
  adminUserId: string;
  sessionId: string;
  assignments: readonly RoleAssignment[];
};

/**
 * An admin user narrowed to one site (sites plan §H). `roleIds`: roles assigned on this site or on every
 * site; site actions and content actions are evaluated against them. `networkRoleIds`: roles assigned on
 * every site only; network actions (users, roles, schema, audit, sites) are evaluated against them, so a
 * site-only role can never reach the network. `siteId` null: a network route, where `roleIds` equals
 * `networkRoleIds`.
 */
export type AdminPrincipal = {
  kind: 'admin';
  adminUserId: string;
  sessionId: string;
  /** Every assignment, on any site (which sites the admin works on). */
  assignments: readonly RoleAssignment[];
  siteId: string | null;
  roleIds: readonly string[];
  networkRoleIds: readonly string[];
};

/**
 * An app user: an end user of one site (sites plan §H). `roleIds`: the custom app roles assigned to the
 * account; the roles bound to the site's `authenticated` audience (`site_app_roles`) apply on top.
 * `siteId`: the account's site, from the access token's `site` claim; the account acts on no other site.
 */
export type AppUserPrincipal = {
  kind: 'appUser';
  appUserId: string;
  siteId: string;
  roleIds: readonly string[];
};

/** API tokens bind to exactly one role: an admin role or a delivery role. */
export type TokenPrincipal = {
  kind: 'token';
  tokenId: string;
  scope: 'admin' | 'delivery';
  roleId: string;
  /**
   * The token's site; null for a network admin token (its role applies on every site and to network
   * actions). Delivery tokens always have a site.
   */
  siteId: string | null;
};

/**
 * A caller without credentials. On a site route `siteId` is the request's site, and the roles bound to the
 * site's `public` audience (`site_app_roles`) apply. Null before site resolution and on network routes,
 * where an anonymous caller holds no role at all.
 */
export type AnonymousPrincipal = { kind: 'anonymous'; siteId: string | null };

/** Work Shapio does on its own behalf: scheduled jobs, migrations, the worker. Never derived from a request. */
export type SystemPrincipal = { kind: 'system'; component: string };

export type Principal =
  AdminPrincipal | AppUserPrincipal | TokenPrincipal | AnonymousPrincipal | SystemPrincipal;

export const CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish', 'schemaManage'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** Content actions about the shared schema rather than one site's entries: network roles only. */
export const NETWORK_CONTENT_ACTIONS: ReadonlySet<ContentAction> = new Set(['schemaManage']);

/**
 * Actions that are not scoped to one model, in two kinds (sites plan §H):
 * - Network actions are about the whole instance (creating models, managing admin users, roles and sites,
 *   reading the audit log). Only roles assigned on every site grant them: a role held on one site never does,
 *   so a site admin cannot grant themselves other sites.
 * - Site actions are about one site's library, tokens and publishing; any role held on the site grants them.
 */
export const NETWORK_ACTIONS = [
  'schema.create',
  'users.manage',
  'roles.manage',
  'audit.read',
  'sites.manage',
] as const;
export type NetworkAction = (typeof NETWORK_ACTIONS)[number];

export const SITE_ACTIONS = [
  'tokens.manage',
  // Media library (package G): browse; upload, edit and organise; delete and change visibility.
  'media.read',
  'media.write',
  'media.manage',
  // Publishing (package H): the jobs view and scheduling overview; webhooks; deployment connections;
  // triggering and retrying deployment runs; change sets (schema + content shipped as one snapshot) and
  // shipping them (`changes.ship`, split so an agent's role can prepare change sets but not make them live).
  'publishing.manage',
  'webhooks.manage',
  'deployments.manage',
  'deployments.trigger',
  'changes.manage',
  'changes.ship',
] as const;
export type SiteAction = (typeof SITE_ACTIONS)[number];

export const GLOBAL_ACTIONS = [...NETWORK_ACTIONS, ...SITE_ACTIONS] as const;
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
