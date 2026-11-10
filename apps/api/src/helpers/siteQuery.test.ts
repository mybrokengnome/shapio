import { describe, expect, it } from 'vitest';
import {
  deleteSiteParameters,
  pickSiteKey,
  rawSiteQueryCandidates,
  siteHeaderCandidates,
  siteQueryCandidates,
  withoutSiteParameter,
} from './siteQuery.js';

const failureOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    const { statusCode, code, message } = error as { statusCode: number; code: string; message: string };
    return `${statusCode} ${code}: ${message}`;
  }
  return 'no error';
};

describe('pickSiteKey', () => {
  const pick = (headers: Record<string, unknown>, query: Record<string, unknown>) =>
    pickSiteKey([...siteHeaderCandidates(headers), ...siteQueryCandidates(query)]);

  it('reads each spelling, and none names no workspace (empty values name none)', () => {
    expect(pick({ 'shapio-workspace': 'blog' }, {})).toBe('blog');
    expect(pick({ 'shapio-site': 'blog' }, {})).toBe('blog');
    expect(pick({}, { workspace: 'blog' })).toBe('blog');
    expect(pick({}, { site: 'blog' })).toBe('blog');
    expect(pick({}, {})).toBeUndefined();
    expect(pick({ 'shapio-workspace': '' }, { site: '' })).toBeUndefined();
  });

  it('accepts every spelling at once when they agree', () => {
    expect(
      pick({ 'shapio-workspace': 'blog', 'shapio-site': 'blog' }, { workspace: 'blog', site: 'blog' }),
    ).toBe('blog');
  });

  it('refuses any two set values that differ (403 SITE_MISMATCH), naming both sources', () => {
    expect(failureOf(() => pick({ 'shapio-workspace': 'a', 'shapio-site': 'b' }, {}))).toBe(
      '403 SITE_MISMATCH: The Shapio-Workspace header and the Shapio-Site header name different workspaces',
    );
    expect(failureOf(() => pick({ 'shapio-site': 'a' }, { workspace: 'b' }))).toBe(
      '403 SITE_MISMATCH: The Shapio-Site header and ?workspace= name different workspaces',
    );
    expect(failureOf(() => pick({}, { workspace: 'a', site: 'b' }))).toBe(
      '403 SITE_MISMATCH: ?workspace= and ?site= name different workspaces',
    );
  });

  it('refuses a repeated parameter (400) instead of falling back to the primary workspace', () => {
    expect(failureOf(() => pick({}, { site: ['a', 'b'] }))).toMatch(
      /^400 INVALID_QUERY: \?site= is given more/,
    );
    expect(failureOf(() => pickSiteKey(rawSiteQueryCandidates('workspace=a&workspace=a')))).toMatch(
      /^400 INVALID_QUERY/,
    );
    expect(pickSiteKey(rawSiteQueryCandidates('locale=fr&site=blog'))).toBe('blog');
  });
});

describe('the strippers', () => {
  it('remove both parameters from a raw query, leaving the rest as sent', () => {
    expect(withoutSiteParameter('workspace=a&filters[title][$eq]=x&site=a&sort=title')).toBe(
      'filters[title][$eq]=x&sort=title',
    );
    expect(withoutSiteParameter('%77orkspace=a&locale=fr')).toBe('locale=fr');
    expect(withoutSiteParameter('sites=a&workspaces=b')).toBe('sites=a&workspaces=b');
  });

  it('remove both parameters from a parsed query', () => {
    const query: Record<string, unknown> = { workspace: 'a', site: 'a', locale: 'fr' };
    deleteSiteParameters(query);
    expect(query).toEqual({ locale: 'fr' });
    expect(() => deleteSiteParameters(undefined)).not.toThrow();
  });
});
