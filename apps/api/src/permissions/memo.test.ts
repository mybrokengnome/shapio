import { describe, expect, it, vi } from 'vitest';
import { memoizePermissions } from './memo.js';
import { DENIED_POLICY, type PermissionEvaluator, type PermissionExecutor, type Principal } from './types.js';

describe('memoizePermissions', () => {
  it('evaluates each (action, model) once per request', async () => {
    const evaluate = vi.fn<PermissionEvaluator['evaluate']>(async () => DENIED_POLICY);
    const base: PermissionEvaluator = {
      evaluate,
      canPerform: async () => false,
      canPerformOnSite: async () => false,
    };
    const principal: Principal = { kind: 'anonymous', siteId: null };
    const memo = memoizePermissions(base, principal);
    await Promise.all([
      memo.evaluate(principal, { action: 'read', modelId: 'a' }),
      memo.evaluate(principal, { action: 'read', modelId: 'a' }),
      memo.evaluate(principal, { action: 'read', modelId: 'b' }),
      memo.evaluate(principal, { action: 'create', modelId: 'a' }),
    ]);
    expect(evaluate).toHaveBeenCalledTimes(3);
    await memo.evaluate({ kind: 'anonymous', siteId: null }, { action: 'read', modelId: 'a' });
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it('reuses a settled policy on every executor, and shares a pending one only on its own', async () => {
    let release: (() => void) | undefined;
    const evaluate = vi.fn<PermissionEvaluator['evaluate']>(
      () =>
        new Promise((resolve) => {
          release = () => resolve(DENIED_POLICY);
        }),
    );
    const base: PermissionEvaluator = {
      evaluate,
      canPerform: async () => false,
      canPerformOnSite: async () => false,
    };
    const principal: Principal = { kind: 'anonymous', siteId: null };
    const memo = memoizePermissions(base, principal);
    const transaction = {} as PermissionExecutor;
    const onPool = memo.evaluate(principal, { action: 'read', modelId: 'a' });
    const releasePool = release;
    const inTransaction = memo.evaluate(principal, { action: 'read', modelId: 'a' }, transaction);
    expect(evaluate).toHaveBeenCalledTimes(2);
    releasePool?.();
    release?.();
    await Promise.all([onPool, inTransaction]);
    await memo.evaluate(principal, { action: 'read', modelId: 'a' }, {} as PermissionExecutor);
    await memo.evaluate(principal, { action: 'read', modelId: 'a' });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
