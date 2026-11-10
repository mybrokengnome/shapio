import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../permissions/types.js';
import {
  LENS_BUILDS_PER_MINUTE,
  lensBudgetKeyOf,
  resetLensBuildBudgets,
  takeLensBuildBudget,
} from './budget.js';

describe('takeLensBuildBudget', () => {
  afterEach(() => resetLensBuildBudgets());

  it('allows a minute of builds, then refuses until the bucket refills', () => {
    const now = 1_000_000;
    for (let build = 0; build < LENS_BUILDS_PER_MINUTE; build += 1) {
      expect(takeLensBuildBudget('token:a', now)).toBe(true);
    }
    expect(takeLensBuildBudget('token:a', now)).toBe(false);
    expect(takeLensBuildBudget('token:b', now)).toBe(true);
    expect(takeLensBuildBudget('token:a', now + 60_000 / LENS_BUILDS_PER_MINUTE)).toBe(true);
    expect(takeLensBuildBudget('token:a', now + 60_000 / LENS_BUILDS_PER_MINUTE)).toBe(false);
  });
});

describe('lensBudgetKeyOf', () => {
  it('keys tokens, admins and app users each, anonymous callers per workspace, and exempts system work', () => {
    const anonymous: Principal = { kind: 'anonymous', siteId: null };
    expect(lensBudgetKeyOf({ kind: 'token', tokenId: 't1' } as Principal, 's1')).toBe('token:t1');
    expect(lensBudgetKeyOf({ kind: 'admin', adminUserId: 'a1' } as Principal, 's1')).toBe('admin:a1');
    expect(lensBudgetKeyOf({ kind: 'appUser', appUserId: 'u1' } as Principal, 's1')).toBe('app_user:u1');
    expect(lensBudgetKeyOf(anonymous, 's1')).toBe('anonymous:s1');
    expect(lensBudgetKeyOf(anonymous, 's2')).toBe('anonymous:s2');
    expect(lensBudgetKeyOf(anonymous, null)).toBe('anonymous:shared');
    expect(lensBudgetKeyOf({ kind: 'system', component: 'jobs' }, 's1')).toBeNull();
  });
});
