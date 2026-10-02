import { describe, expect, it } from 'vitest';
import { createUrlBuilder, InvalidUrlPathError, loopbackUrl } from './publicUrl.js';

describe('createUrlBuilder', () => {
  const root = createUrlBuilder({ publicUrl: 'https://cms.example.com/', basePath: '' });
  const nested = createUrlBuilder({ publicUrl: 'https://example.com:8443', basePath: '/cms' });

  it('builds absolute URLs from PUBLIC_URL and BASE_PATH', () => {
    expect(root.absoluteUrl('/api/ready')).toBe('https://cms.example.com/api/ready');
    expect(nested.absoluteUrl('/api/ready')).toBe('https://example.com:8443/cms/api/ready');
    expect(nested.absoluteUrl('/')).toBe('https://example.com:8443/cms/');
  });

  it('prefixes server paths with BASE_PATH', () => {
    expect(nested.withBasePath('/admin/')).toBe('/cms/admin/');
    expect(root.withBasePath('/api')).toBe('/api');
  });

  it.each(['api/ready', '//evil.example/x', 'https://evil.example'])('rejects %j', (path) => {
    expect(() => nested.absoluteUrl(path)).toThrow(InvalidUrlPathError);
  });

  it('keeps redirects on the public origin', () => {
    expect(nested.originUrl('/cms/admin?x=1')).toBe('https://example.com:8443/cms/admin?x=1');
    expect(nested.originUrl('//evil.example/path')).toBe('https://example.com:8443/evil.example/path');
    expect(nested.originUrl('*')).toBe('https://example.com:8443/');
  });
});

describe('loopbackUrl', () => {
  it('targets 127.0.0.1 with the right scheme, port and base path', () => {
    expect(loopbackUrl({ port: 4300, basePath: '', https: false }, '/api/ready')).toBe(
      'http://127.0.0.1:4300/api/ready',
    );
    expect(loopbackUrl({ port: 443, basePath: '/cms', https: true }, '/api/ready')).toBe(
      'https://127.0.0.1:443/cms/api/ready',
    );
  });
});
