import { APP_CONTENT_ACTIONS } from './appRoles.js';
import type { GrantSource } from './cache.js';
import {
  ALLOW_ALL_POLICY,
  allowsGlobalAction,
  buildPolicy,
  type Audience,
  type FieldVisibilityLookup,
} from './policy.js';
import { tokenNetworkRoleIds } from './sites.js';
import {
  DENIED_POLICY,
  NETWORK_ACTIONS,
  NETWORK_CONTENT_ACTIONS,
  SITE_GRANTABLE_ACTIONS,
  type ContentAction,
  type GlobalAction,
  type KnownVersions,
  type PermissionEvaluator,
  type PermissionExecutor,
  type Principal,
} from './types.js';

const NETWORK_ACTION_SET: ReadonlySet<GlobalAction> = new Set(NETWORK_ACTIONS);

type PrincipalRoles = {
  /** Roles that apply on the request's site (content and site actions). */
  roleIds: readonly string[];
  /** Roles that apply to the whole instance (network actions); a role held on one site is never here. */
  networkRoleIds: readonly string[];
  audience: Audience;
  /** Content actions the principal kind may ever perform; `all` = whatever its roles grant. */
  actions: ReadonlySet<ContentAction> | 'all';
};

const READ_ONLY: ReadonlySet<ContentAction> = new Set(['read']);
const APP_ACTIONS: ReadonlySet<ContentAction> = new Set(APP_CONTENT_ACTIONS);

/**
 * Which roles a principal holds and how its masks are computed. App users hold the custom app roles assigned
 * to them plus the roles their site binds to `authenticated`; anonymous callers hold the roles the request's
 * site binds to `public` (`site_app_roles`: a site that binds nothing grants nothing, and an anonymous caller
 * outside a site holds no role). Both are delivery audiences: they see `public: false` fields only where a
 * grant names them.
 */
const rolesOf = async (
  principal: Principal,
  grants: GrantSource,
  executor: PermissionExecutor | undefined,
  versions: KnownVersions | undefined,
): Promise<PrincipalRoles | 'all'> => {
  switch (principal.kind) {
    case 'system':
      return 'all';
    case 'admin':
      return {
        roleIds: principal.roleIds,
        networkRoleIds: principal.networkRoleIds,
        audience: 'admin',
        actions: 'all',
      };
    case 'token':
      return principal.scope === 'admin'
        ? {
            roleIds: [principal.roleId],
            networkRoleIds: tokenNetworkRoleIds(principal),
            audience: 'admin',
            actions: 'all',
          }
        : // Delivery tokens only ever read, whatever their role says.
          { roleIds: [principal.roleId], networkRoleIds: [], audience: 'delivery', actions: READ_ONLY };
    case 'appUser':
      return {
        roleIds: [
          ...(await grants.getSiteAppRoleIds(principal.siteId, 'authenticated', executor, versions)),
          ...principal.roleIds,
        ],
        networkRoleIds: [],
        audience: 'delivery',
        actions: APP_ACTIONS,
      };
    case 'anonymous':
      return {
        roleIds:
          principal.siteId === null
            ? []
            : await grants.getSiteAppRoleIds(principal.siteId, 'public', executor, versions),
        networkRoleIds: [],
        audience: 'delivery',
        actions: APP_ACTIONS,
      };
  }
};

type EvaluatorDependencies = { grants: GrantSource; fields: FieldVisibilityLookup };

/**
 * Whether the principal acts on `siteId`: an admin narrowed to it, a site token of it, or a network token
 * (whose role applies on every site). Never an app user or anonymous caller (schema actions are admin-only).
 */
const actsOnSite = (principal: Principal, siteId: string): boolean => {
  switch (principal.kind) {
    case 'admin':
      return principal.siteId === siteId;
    case 'token':
      return principal.scope === 'admin' && (principal.siteId === null || principal.siteId === siteId);
    default:
      return false;
  }
};

/**
 * The one permission evaluator (ADR 0005): principal → roles → grants → Policy, for REST and GraphQL.
 * Deny by default at every step. `atVersions` gives the same evaluator for one request, whose caches are
 * checked against the versions the request read once instead of read again on every call.
 */
export const createPermissionEvaluator = ({ grants, fields }: EvaluatorDependencies): PermissionEvaluator => {
  const at = (versions: KnownVersions | undefined): PermissionEvaluator => ({
    evaluate: async (principal, request, executor) => {
      const roles = await rolesOf(principal, grants, executor, versions);
      if (roles === 'all') {
        return ALLOW_ALL_POLICY;
      }
      if (roles.actions !== 'all' && !roles.actions.has(request.action)) {
        return DENIED_POLICY;
      }
      // Schema management of a shared definition: network roles only (sites plan §H). Of a site's own
      // definition: the roles that apply on that site, when the principal acts there (plan site-schema).
      let roleIds = roles.roleIds;
      if (NETWORK_CONTENT_ACTIONS.has(request.action)) {
        const modelSite = await fields.getModelSite(request.modelId, executor, versions);
        roleIds =
          modelSite !== null && actsOnSite(principal, modelSite) ? roles.roleIds : roles.networkRoleIds;
      }
      const held = await grants.getGrants(roleIds, executor, versions);
      if (held.length === 0) {
        return DENIED_POLICY;
      }
      const modelFields =
        roles.audience === 'delivery'
          ? await fields.getModelFields(request.modelId, executor, versions)
          : undefined;
      return buildPolicy(held, request, roles.audience, modelFields);
    },
    canPerform: async (principal, action, executor) => {
      const roles = await rolesOf(principal, grants, executor, versions);
      if (roles === 'all') {
        return true;
      }
      if (roles.audience === 'delivery') {
        return false;
      }
      // Network actions only count roles assigned on every site, so a site role never reaches the network.
      const roleIds = NETWORK_ACTION_SET.has(action) ? roles.networkRoleIds : roles.roleIds;
      return allowsGlobalAction(await grants.getGrants(roleIds, executor, versions), action);
    },
    canPerformOnSite: async (principal, action, siteId, executor) => {
      const roles = await rolesOf(principal, grants, executor, versions);
      if (roles === 'all') {
        return true;
      }
      if (roles.audience === 'delivery') {
        return false;
      }
      const counted =
        !NETWORK_ACTION_SET.has(action) ||
        (SITE_GRANTABLE_ACTIONS.has(action) && actsOnSite(principal, siteId))
          ? roles.roleIds
          : roles.networkRoleIds;
      return allowsGlobalAction(await grants.getGrants(counted, executor, versions), action);
    },
    atVersions: at,
  });
  return at(undefined);
};
