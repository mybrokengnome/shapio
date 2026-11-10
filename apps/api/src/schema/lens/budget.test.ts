import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../permissions/types.js';
import {
  LENS_APP_USER_BUILDS_PER_MINUTE,
  LENS_BUILDS_PER_MINUTE,
  lensBudgetKeyOf,
  previewLensBudgetKey,
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

  it('refills nothing when the clock goes backwards', () => {
    const now = 1_000_000;
    for (let build = 0; build < LENS_BUILDS_PER_MINUTE; build += 1) {
      takeLensBuildBudget('token:a', now);
    }
    expect(takeLensBuildBudget('token:a', now - 3_600_000)).toBe(false);
    // Refill counts from the jumped-back time, never from the future.
    expect(takeLensBuildBudget('token:a', now - 3_600_000 + 60_000 / LENS_BUILDS_PER_MINUTE)).toBe(true);
  });

  it('holds all app users of a workspace to one ceiling, and takes nothing from a bucket when another is empty', () => {
    const now = 1_000_000;
    const appUser = (id: string) =>
      lensBudgetKeyOf({ kind: 'appUser', appUserId: id } as Principal, 's1') as string;
    let allowed = 0;
    for (let user = 0; user < LENS_APP_USER_BUILDS_PER_MINUTE; user += 1) {
      allowed += takeLensBuildBudget(appUser(`u${user}`), now) ? 1 : 0;
    }
    expect(allowed).toBe(LENS_APP_USER_BUILDS_PER_MINUTE);
    expect(takeLensBuildBudget(appUser('fresh'), now)).toBe(false);
    // The refused user's own bucket was not charged.
    resetLensBuildBudgets();
    expect(takeLensBuildBudget(appUser('other-workspace').replace('s1', 's2'), now)).toBe(true);
  });
});

describe('lensBudgetKeyOf', () => {
  it('keys tokens, admins, app users, previews, and anonymous callers per address, and exempts system work', () => {
    const anonymous: Principal = { kind: 'anonymous', siteId: null };
    expect(lensBudgetKeyOf({ kind: 'token', tokenId: 't1' } as Principal, 's1')).toBe('token:t1');
    expect(lensBudgetKeyOf({ kind: 'admin', adminUserId: 'a1' } as Principal, 's1')).toBe('admin:a1');
    expect(lensBudgetKeyOf({ kind: 'appUser', appUserId: 'u1' } as Principal, 's1')).toBe(
      'app_user:u1|app_users:s1',
    );
    expect(lensBudgetKeyOf(anonymous, 's1', '10.0.0.1')).toBe('anonymous:s1:10.0.0.1');
    expect(lensBudgetKeyOf(anonymous, 's1', '10.0.0.2')).toBe('anonymous:s1:10.0.0.2');
    expect(lensBudgetKeyOf(anonymous, null, '::1')).toBe('anonymous:shared:::1');
    expect(previewLensBudgetKey('p1')).toBe('preview:p1');
    expect(lensBudgetKeyOf({ kind: 'system', component: 'jobs' }, 's1')).toBeNull();
  });
});
