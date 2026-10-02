import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const ADMIN_FIXTURE = resolve(import.meta.dirname, 'fixtures/admin-dist');

describe('BASE_PATH sub-path hosting', () => {
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

  it('mounts the API under BASE_PATH only', async () => {
    expect((await get('/cms/api/ready')).statusCode).toBe(200);
    expect((await get('/api/ready')).statusCode).toBe(404);
  });

  it('serves the admin under BASE_PATH with an injected base href', async () => {
    const response = await get('/cms/admin/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<base href="/cms/admin/" />');
  });

  it('falls back to the SPA shell for client-side routes', async () => {
    const response = await get('/cms/admin/content/pages/42');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<base href="/cms/admin/" />');
  });

  it('serves hashed assets with long-lived caching', async () => {
    const response = await get('/cms/admin/assets/app-abc123.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('redirects the bare base path to the admin', async () => {
    for (const url of ['/cms', '/cms/']) {
      const response = await get(url);
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/cms/admin/');
    }
  });

  it('builds absolute URLs from PUBLIC_URL and BASE_PATH', () => {
    expect(testApp.app.urls.absoluteUrl('/api/ready')).toBe('https://example.com/cms/api/ready');
  });

  it('sends HSTS only for an https PUBLIC_URL', async () => {
    expect((await get('/cms/api/health')).headers['strict-transport-security']).toBeDefined();
    const plain = await createTestApp(database.current, { env: { PUBLIC_URL: 'http://cms.lan:4300' } });
    try {
      const response = await plain.app.inject({ method: 'GET', url: '/api/health' });
      expect(response.headers['strict-transport-security']).toBeUndefined();
      expect(String(response.headers['content-security-policy'])).not.toContain('upgrade-insecure-requests');
    } finally {
      await plain.app.close();
    }
  });
});
