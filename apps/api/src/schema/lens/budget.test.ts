import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../permissions/types.js';
import {
  LENS_APP_USER_BUILDS_PER_MINUTE,
  LENS_BUILDS_PER_MINUTE,
  clientNetworkOf,
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

  it('gives each app user a small budget, and caps all accounts from one network together', () => {
    const now = 1_000_000;
    const appUser = (id: string, address: string) =>
      lensBudgetKeyOf({ kind: 'appUser', appUserId: id } as Principal, 's1', address) as string;
    let builds = 0;
    while (takeLensBuildBudget(appUser('one', '198.51.100.1'), now)) {
      builds += 1;
    }
    expect(builds).toBe(LENS_APP_USER_BUILDS_PER_MINUTE);
    // Sixty accounts signed up from one network share its ceiling.
    let fromOneNetwork = 0;
    for (let user = 0; user < 60; user += 1) {
      while (takeLensBuildBudget(appUser(`sock-${user}`, '203.0.113.9'), now)) {
        fromOneNetwork += 1;
      }
    }
    expect(fromOneNetwork).toBe(LENS_BUILDS_PER_MINUTE);
    // An account on another network is unaffected.
    expect(takeLensBuildBudget(appUser('real', '2001:db8:1:2::5'), now)).toBe(true);
  });
});

describe('clientNetworkOf', () => {
  it('budgets IPv4 per address and IPv6 per /64, whatever the spelling', () => {
    expect(clientNetworkOf('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetworkOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetworkOf('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(clientNetworkOf('2001:DB8:AA:BB:ffff::9')).toBe('2001:db8:aa:bb::/64');
    expect(clientNetworkOf('2001:0db8:00aa:00bb::1%eth0')).toBe('2001:db8:aa:bb::/64');
    expect(clientNetworkOf('2001:db8:aa:bc::1')).not.toBe(clientNetworkOf('2001:db8:aa:bb::1'));
    expect(clientNetworkOf('::1')).toBe('0:0:0:0::/64');
    // Not an IP address (a forged forwarded header): one shared network, whatever the string.
    expect(clientNetworkOf('not an address')).toBe('unknown');
    expect(clientNetworkOf('1.2.3.4, 5.6.7.8')).toBe('unknown');
    expect(clientNetworkOf(`::1${'x'.repeat(10_000)}`)).toBe('unknown');
    expect(clientNetworkOf('999.1.1.1')).toBe('unknown');
  });
});

describe('lensBudgetKeyOf', () => {
  it('keys tokens, admins, app users, previews, and anonymous callers per address, and exempts system work', () => {
    const anonymous: Principal = { kind: 'anonymous', siteId: null };
    expect(lensBudgetKeyOf({ kind: 'token', tokenId: 't1' } as Principal, 's1')).toBe('token:t1');
    expect(lensBudgetKeyOf({ kind: 'admin', adminUserId: 'a1' } as Principal, 's1')).toBe('admin:a1');
    expect(lensBudgetKeyOf({ kind: 'appUser', appUserId: 'u1' } as Principal, 's1', '10.0.0.1')).toBe(
      'app_user:u1|network:s1:10.0.0.1',
    );
    expect(lensBudgetKeyOf(anonymous, 's1', '10.0.0.1')).toBe('anonymous:s1:10.0.0.1');
    expect(lensBudgetKeyOf(anonymous, 's1', '10.0.0.2')).toBe('anonymous:s1:10.0.0.2');
    expect(lensBudgetKeyOf(anonymous, null, '2001:db8:1:2::1')).toBe('anonymous:shared:2001:db8:1:2::/64');
    expect(previewLensBudgetKey('p1')).toBe('preview:p1');
    expect(lensBudgetKeyOf({ kind: 'system', component: 'jobs' }, 's1')).toBeNull();
  });
});
