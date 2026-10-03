import { describe, expect, it, vi } from 'vitest';
import { DENIED_POLICY, type PermissionEvaluator, type Principal } from '../../../permissions/types.js';
import { memoizePermissions } from './permissions.js';

describe('memoizePermissions', () => {
  it('evaluates each (action, model) once per request', async () => {
    const evaluate = vi.fn<PermissionEvaluator['evaluate']>(async () => DENIED_POLICY);
    const base: PermissionEvaluator = { evaluate, canPerform: async () => false };
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
});
