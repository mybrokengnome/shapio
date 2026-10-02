import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const ADMIN_FIXTURE = resolve(import.meta.dirname, 'fixtures/admin-dist-importmap');
const IMPORT_MAP = '{"imports":{"react":"./assets/shared-react-abc123.js"}}';

describe('admin SPA serving (import map, fallback)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      env: { BASE_PATH: '/cms', PUBLIC_URL: 'https://example.com' },
      adminDistPath: ADMIN_FIXTURE,
    });
  });
  afterAll(() => testApp.app.close());

  const get = (url: string) => testApp.app.inject({ method: 'GET', url });

  it('allows exactly the inline import map in the CSP, on every SPA route', async () => {
    const hash = `'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'`;
    for (const url of ['/cms/admin/', '/cms/admin/settings/audit-log?action=x']) {
      const response = await get(url);
      expect(response.statusCode).toBe(200);
      const csp = String(response.headers['content-security-policy']);
      expect(csp).toMatch(new RegExp(`script-src 'self' ${hash.replace(/[+/]/g, '\\$&')}(;|$)`));
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    }
  });

  it('puts <base href> before the import map so its relative URLs resolve under BASE_PATH', async () => {
    const { body } = await get('/cms/admin/settings/profile');
    expect(body.indexOf('<base href="/cms/admin/" />')).toBeLessThan(body.indexOf('type="importmap"'));
  });

  it('answers a missing file with 404 rather than the SPA shell', async () => {
    expect((await get('/cms/admin/assets/missing-abc123.js')).statusCode).toBe(404);
    expect((await get('/cms/admin/assets/app-abc123.js')).statusCode).toBe(200);
  });
});
