import type { PermissionEvaluator, Policy, Principal } from '../../../permissions/types.js';

/**
 * The request's evaluator, memoized per (model, action): a GraphQL request touches the same models many
 * times (lists, relation batches, localizations), and evaluates each policy once (ADR 0005). Calls for
 * another principal (never made by content services today) bypass the memo.
 */
export const memoizePermissions = (base: PermissionEvaluator, principal: Principal): PermissionEvaluator => {
  const policies = new Map<string, Promise<Policy>>();
  return {
    evaluate: (caller, request) => {
      if (caller !== principal) {
        return base.evaluate(caller, request);
      }
      const key = `${request.action}:${request.modelId}`;
      let policy = policies.get(key);
      if (!policy) {
        policy = base.evaluate(caller, request);
        policies.set(key, policy);
      }
      return policy;
    },
    canPerform: (caller, action) => base.canPerform(caller, action),
    canPerformOnSite: (caller, action, siteId) => base.canPerformOnSite(caller, action, siteId),
  };
};
