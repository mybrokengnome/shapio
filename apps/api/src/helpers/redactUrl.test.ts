import { describe, expect, it } from 'vitest';
import { redactUrlSecrets } from './redactUrl.js';

describe('redactUrlSecrets', () => {
  it('keeps URLs without secrets unchanged', () => {
    expect(redactUrlSecrets('/api/content/post?page=2&sort=title:asc')).toBe(
      '/api/content/post?page=2&sort=title:asc',
    );
    expect(redactUrlSecrets('/api/health')).toBe('/api/health');
  });

  it('replaces credential-bearing query values, whatever their case', () => {
    expect(redactUrlSecrets('/api/media/f/a/b.png?expires=123&signature=abcdef')).toBe(
      '/api/media/f/a/b.png?expires=123&signature=%5Bredacted%5D',
    );
    const callback = redactUrlSecrets('/api/app-auth/oauth/github/callback?code=c0de&State=st4te');
    expect(callback).not.toContain('c0de');
    expect(callback).not.toContain('st4te');
  });
});
