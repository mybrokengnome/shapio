import { APP_CONTENT_ACTIONS, APP_ROLE_IDS } from './appRoles.js';
import type { GrantSource } from './cache.js';
import {
  ALLOW_ALL_POLICY,
  allowsGlobalAction,
  buildPolicy,
  type Audience,
  type FieldVisibilityLookup,
} from './policy.js';
import { DENIED_POLICY, type ContentAction, type PermissionEvaluator, type Principal } from './types.js';

type PrincipalRoles = {
  roleIds: readonly string[];
  audience: Audience;
  /** Content actions the principal kind may ever perform; `all` = whatever its roles grant. */
  actions: ReadonlySet<ContentAction> | 'all';
};

const READ_ONLY: ReadonlySet<ContentAction> = new Set(['read']);
const APP_ACTIONS: ReadonlySet<ContentAction> = new Set(APP_CONTENT_ACTIONS);

/**
 * Which roles a principal holds and how its masks are computed. App users hold `authenticated` plus the
 * custom app roles resolved for them; anonymous callers hold `public`. Both are delivery audiences: they see
 * `public: false` fields only where a grant names them.
 */
const rolesOf = (principal: Principal): PrincipalRoles | 'all' => {
  switch (principal.kind) {
    case 'system':
      return 'all';
    case 'admin':
      return { roleIds: principal.roleIds, audience: 'admin', actions: 'all' };
    case 'token':
      return principal.scope === 'admin'
        ? { roleIds: [principal.roleId], audience: 'admin', actions: 'all' }
        : // Delivery tokens only ever read, whatever their role says.
          { roleIds: [principal.roleId], audience: 'delivery', actions: READ_ONLY };
    case 'appUser':
      return {
        roleIds: [APP_ROLE_IDS.authenticated, ...principal.roleIds],
        audience: 'delivery',
        actions: APP_ACTIONS,
      };
    case 'anonymous':
      return { roleIds: [APP_ROLE_IDS.public], audience: 'delivery', actions: APP_ACTIONS };
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
    const roles = rolesOf(principal);
    if (roles === 'all') {
      return ALLOW_ALL_POLICY;
    }
    if (roles.actions !== 'all' && !roles.actions.has(request.action)) {
      return DENIED_POLICY;
    }
    const held = await grants.getGrants(roles.roleIds);
    if (held.length === 0) {
      return DENIED_POLICY;
    }
    const modelFields =
      roles.audience === 'delivery' ? await fields.getModelFields(request.modelId) : undefined;
    return buildPolicy(held, request, roles.audience, modelFields);
  },
  canPerform: async (principal, action) => {
    const roles = rolesOf(principal);
    if (roles === 'all') {
      return true;
    }
    if (roles.audience === 'delivery') {
      return false;
    }
    return allowsGlobalAction(await grants.getGrants(roles.roleIds), action);
  },
});
