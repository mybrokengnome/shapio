import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { describeIssue } from './describeIssue';

beforeAll(async () => {
  await initI18n();
});

describe('describeIssue', () => {
  it('translates a known code and falls back to the server text', () => {
    expect(describeIssue({ code: 'API_KEY_RESERVED', message: 'reserved' })).toBe(
      'This name is reserved. Choose another.',
    );
    expect(describeIssue({ code: 'SOMETHING_NEW', message: 'Server text' })).toBe('Server text');
  });

  it('names the site where a taken API ID is used', () => {
    expect(describeIssue({ code: 'API_KEY_COLLISION', message: 'taken', siteKey: 'blog' })).toBe(
      'Already used on blog.',
    );
    expect(describeIssue({ code: 'API_KEY_COLLISION', message: 'taken' })).toBe(
      'Another one already uses this API ID (IDs are case-insensitive).',
    );
  });

  it('keeps the generic text for other issues found on a site', () => {
    expect(describeIssue({ code: 'API_KEY_RESERVED', message: 'reserved', siteKey: 'blog' })).toBe(
      'This name is reserved. Choose another.',
    );
  });
});
