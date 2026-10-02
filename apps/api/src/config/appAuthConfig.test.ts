import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index.js';

const load = (env: Record<string, string>) =>
  loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/x', ...env });

describe('app-user auth configuration', () => {
  it('parses APP_AUTH_RETURN_URLS and leaves it unset by default', () => {
    expect(load({}).appAuth.returnUrls).toBeUndefined();
    expect(
      load({ APP_AUTH_RETURN_URLS: 'https://www.example.com, myapp://auth' }).appAuth.returnUrls,
    ).toEqual(['https://www.example.com', 'myapp://auth']);
  });

  it('rejects unsafe or non-origin return URLs', () => {
    for (const value of ['javascript://x', 'https://www.example.com/path', 'not a url', 'data://x']) {
      expect(() => load({ APP_AUTH_RETURN_URLS: value }), value).toThrow(ConfigError);
    }
  });

  it('requires a confirm URL when confirmation is required, and OAuth credentials in pairs', () => {
    expect(() => load({ APP_AUTH_REQUIRE_EMAIL_CONFIRMATION: 'true' })).toThrow(ConfigError);
    expect(() => load({ APP_AUTH_GITHUB_CLIENT_ID: 'id' })).toThrow(ConfigError);
  });
});
