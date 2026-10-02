import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safeRedirect';

describe('safeRedirectPath', () => {
  it('keeps in-app paths', () => {
    expect(safeRedirectPath('/settings/profile?x=1')).toBe('/settings/profile?x=1');
  });

  it.each([
    undefined,
    '',
    'settings',
    '//evil.test',
    'https://evil.test',
    '/\\evil.test',
    '/\t/evil.test',
    '/\n/evil.test',
    '/\r//evil.test',
    '/\u0000/evil.test',
    42,
  ])('falls back to the dashboard for %s', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });
});
