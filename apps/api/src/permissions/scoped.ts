import { memoizePermissions } from './memo.js';
import type { KnownVersions, PermissionEvaluator, PermissionExecutor, Principal } from './types.js';

/**
 * Where a scope's durable versions come from. HTTP reads them lazily, once per request (`plugins/requestState.ts`):
 * `read` reads them (or returns the read already made) and `isRead` says whether a read was started. A caller
 * that already holds them passes the versions themselves.
 */
export type ScopeVersions = KnownVersions | { read: () => Promise<KnownVersions>; isRead: () => boolean };

const isLazy = (
  versions: ScopeVersions,
): versions is { read: () => Promise<KnownVersions>; isRead: () => boolean } => 'read' in versions;

/**
 * The evaluator at the scope's versions. Inside a transaction before a lazy scope read its versions, the
 * unbound evaluator checks the versions itself through the transaction, so no pooled connection is asked
 * for while the transaction holds one.
 */
const boundEvaluator = async (
  base: PermissionEvaluator,
  versions: ScopeVersions,
  executor: PermissionExecutor | undefined,
): Promise<PermissionEvaluator> => {
  if (!isLazy(versions)) {
    return base.atVersions?.(versions) ?? base;
  }
  if (executor && !versions.isRead()) {
    return base;
  }
  return base.atVersions?.(await versions.read()) ?? base;
};

/**
 * One scope's evaluator (an HTTP request, an in-process delivery call): checked against the scope's durable
 * versions (ADR 0005: a revoke applies from the next scope, not mid-scope) and memoized per (principal, action,
 * model) for the scope (`memo.ts`).
 */
export const scopePermissions = (
  base: PermissionEvaluator,
  principal: Principal,
  versions: ScopeVersions,
): PermissionEvaluator =>
  memoizePermissions(
    {
      evaluate: async (caller, policyRequest, executor) =>
        (await boundEvaluator(base, versions, executor)).evaluate(caller, policyRequest, executor),
      canPerform: async (caller, action, executor) =>
        (await boundEvaluator(base, versions, executor)).canPerform(caller, action, executor),
      canPerformOnSite: async (caller, action, siteId, executor) =>
        (await boundEvaluator(base, versions, executor)).canPerformOnSite(caller, action, siteId, executor),
    },
    principal,
  );
