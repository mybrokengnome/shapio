import type {
  PermissionEvaluator,
  PermissionExecutor,
  Policy,
  Principal,
} from '../../../permissions/types.js';

/**
 * The request's evaluator, memoized per (model, action): a GraphQL request touches the same models many
 * times (lists, relation batches, localizations), and evaluates each policy once (ADR 0005). Calls for
 * another principal (never made by content services today) bypass the memo. The memo is kept per executor:
 * a policy evaluated inside one root field's read transaction is never awaited from another's.
 */
export const memoizePermissions = (base: PermissionEvaluator, principal: Principal): PermissionEvaluator => {
  const pooled = new Map<string, Promise<Policy>>();
  const byTransaction = new WeakMap<PermissionExecutor, Map<string, Promise<Policy>>>();
  const memoFor = (executor: PermissionExecutor | undefined) => {
    if (!executor) {
      return pooled;
    }
    let memo = byTransaction.get(executor);
    if (!memo) {
      memo = new Map();
      byTransaction.set(executor, memo);
    }
    return memo;
  };
  return {
    evaluate: (caller, request, executor) => {
      if (caller !== principal) {
        return base.evaluate(caller, request, executor);
      }
      const memo = memoFor(executor);
      const key = `${request.action}:${request.modelId}`;
      let policy = memo.get(key);
      if (!policy) {
        policy = base.evaluate(caller, request, executor);
        memo.set(key, policy);
      }
      return policy;
    },
    canPerform: (caller, action, executor) => base.canPerform(caller, action, executor),
    canPerformOnSite: (caller, action, siteId, executor) =>
      base.canPerformOnSite(caller, action, siteId, executor),
  };
};
