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
  type ContentAction,
  type GlobalAction,
  type PermissionEvaluator,
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
const rolesOf = async (principal: Principal, grants: GrantSource): Promise<PrincipalRoles | 'all'> => {
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
          ...(await grants.getSiteAppRoleIds(principal.siteId, 'authenticated')),
          ...principal.roleIds,
        ],
        networkRoleIds: [],
        audience: 'delivery',
        actions: APP_ACTIONS,
      };
    case 'anonymous':
      return {
        roleIds: principal.siteId === null ? [] : await grants.getSiteAppRoleIds(principal.siteId, 'public'),
        networkRoleIds: [],
        audience: 'delivery',
        actions: APP_ACTIONS,
      };
  }
};

type EvaluatorDependencies = { grants: GrantSource; fields: FieldVisibilityLookup };

/**
 * The one permission evaluator (ADR 0005): principal → roles → grants → Policy, for REST and GraphQL.
 * Deny by default at every step.
 */
export const createPermissionEvaluator = ({
  grants,
  fields,
}: EvaluatorDependencies): PermissionEvaluator => ({
  evaluate: async (principal, request) => {
    const roles = await rolesOf(principal, grants);
    if (roles === 'all') {
      return ALLOW_ALL_POLICY;
    }
    if (roles.actions !== 'all' && !roles.actions.has(request.action)) {
      return DENIED_POLICY;
    }
    // Schema management is about the shared schema: only network roles grant it (sites plan §H).
    const roleIds = NETWORK_CONTENT_ACTIONS.has(request.action) ? roles.networkRoleIds : roles.roleIds;
    const held = await grants.getGrants(roleIds);
    if (held.length === 0) {
      return DENIED_POLICY;
    }
    const modelFields =
      roles.audience === 'delivery' ? await fields.getModelFields(request.modelId) : undefined;
    return buildPolicy(held, request, roles.audience, modelFields);
  },
  canPerform: async (principal, action) => {
    const roles = await rolesOf(principal, grants);
    if (roles === 'all') {
      return true;
    }
    if (roles.audience === 'delivery') {
      return false;
    }
    // Network actions only count roles assigned on every site, so a site role never reaches the network.
    const roleIds = NETWORK_ACTION_SET.has(action) ? roles.networkRoleIds : roles.roleIds;
    return allowsGlobalAction(await grants.getGrants(roleIds), action);
  },
});
