import type { PermissionEvaluator, PermissionExecutor, Policy, Principal } from './types.js';

/**
 * One request's evaluator, memoized per (principal, action, model): a request touches the same models many
 * times (REST: the read, relation visibility, populate, usage; GraphQL: lists, relation batches,
 * localizations), and evaluates each policy once (ADR 0005). Calls for another principal bypass the memo.
 * A policy still being evaluated is shared only on the executor that evaluates it: one evaluated inside a
 * read transaction is never awaited from another transaction. Once settled, every executor reuses it.
 */
export const memoizePermissions = (base: PermissionEvaluator, principal: Principal): PermissionEvaluator => {
  const settled = new Map<string, Policy>();
  const pooled = new Map<string, Promise<Policy>>();
  const byTransaction = new WeakMap<PermissionExecutor, Map<string, Promise<Policy>>>();
  const pendingFor = (executor: PermissionExecutor | undefined) => {
    if (!executor) {
      return pooled;
    }
    let pending = byTransaction.get(executor);
    if (!pending) {
      pending = new Map();
      byTransaction.set(executor, pending);
    }
    return pending;
  };
  return {
    evaluate: (caller, request, executor) => {
      if (caller !== principal) {
        return base.evaluate(caller, request, executor);
      }
      const key = `${request.action}:${request.modelId}`;
      const done = settled.get(key);
      if (done) {
        return Promise.resolve(done);
      }
      const pending = pendingFor(executor);
      let policy = pending.get(key);
      if (!policy) {
        policy = base.evaluate(caller, request, executor);
        pending.set(key, policy);
        // A failure reaches the caller through `policy`; here it only keeps the policy out of `settled`.
        policy.then(
          (value) => settled.set(key, value),
          () => undefined,
        );
      }
      return policy;
    },
    canPerform: (caller, action, executor) => base.canPerform(caller, action, executor),
    canPerformOnSite: (caller, action, siteId, executor) =>
      base.canPerformOnSite(caller, action, siteId, executor),
  };
};
