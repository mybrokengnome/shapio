import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addScriptSources, importMapHashes, injectBaseHref, looksLikeFile } from './staticAdmin.js';

describe('injectBaseHref', () => {
  it('adds a base element as the first child of head', () => {
    const html = '<!doctype html><html><head lang="en"><title>x</title></head></html>';
    expect(injectBaseHref(html, '/cms/admin/')).toContain(
      '<head lang="en">\n    <base href="/cms/admin/" />',
    );
  });
});

describe('importMapHashes', () => {
  it('hashes the inline import map content', () => {
    const map = '{"imports":{"react":"./assets/react.js"}}';
    const html = `<head><script type="importmap">${map}</script></head>`;
    const expected = `'sha256-${createHash('sha256').update(map).digest('base64')}'`;
    expect(importMapHashes(html)).toEqual([expected]);
  });

  it('returns nothing without an import map', () => {
    expect(importMapHashes('<head></head>')).toEqual([]);
  });
});

describe('addScriptSources', () => {
  it('appends to an existing script-src directive', () => {
    expect(addScriptSources("default-src 'self';script-src 'self';img-src 'self'", ["'sha256-x'"])).toBe(
      "default-src 'self';script-src 'self' 'sha256-x';img-src 'self'",
    );
  });

  it('adds a script-src directive when there is none', () => {
    expect(addScriptSources("default-src 'self'", ["'sha256-x'"])).toBe(
      "default-src 'self';script-src 'self' 'sha256-x'",
    );
  });

  it('leaves the policy alone when there is nothing to add', () => {
    expect(addScriptSources("default-src 'self'", [])).toBe("default-src 'self'");
  });
});

describe('looksLikeFile', () => {
  it.each(['/admin/assets/app-abc123.js', '/cms/admin/fonts/manrope.woff2?v=1', '/admin/favicon.svg'])(
    '%s is a file',
    (url) => {
      expect(looksLikeFile(url)).toBe(true);
    },
  );

  it.each([
    '/admin/',
    '/admin/settings/profile',
    '/admin/settings/audit-log?action=role.create',
    '/admin/login#x.y',
  ])('%s is an SPA route', (url) => {
    expect(looksLikeFile(url)).toBe(false);
  });
});
