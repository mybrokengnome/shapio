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

  it("says which part of a choice field's settings is wrong", () => {
    const issue = (path: string) => ({ code: 'INVALID_SETTINGS', message: 'must not have fewer…', path });
    expect(describeIssue(issue('/fields/0/settings/values'))).toBe('Add at least one choice.');
    expect(describeIssue(issue('/fields/2/settings/values/1/value'))).toBe(
      'Give every choice a value of up to 64 characters.',
    );
    expect(describeIssue(issue('/fields/2/settings/values/0/label'))).toBe(
      'Give every choice a label of up to 200 characters.',
    );
    expect(describeIssue(issue('/fields/0/settings/min'))).toBe("This setting isn't valid.");
  });
});
