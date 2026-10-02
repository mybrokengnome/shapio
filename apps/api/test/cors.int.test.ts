import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const SITE = 'https://site.example';

const preflight = (app: TestApp['app'], origin: string, method: string, url = '/api/content/posts/1') =>
  app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  });

/**
 * CORS exists only for the user's own sites and apps (the admin shares Shapio's origin). Those callers use
 * bearer tokens, never the admin cookie, so CORS must never allow credentials: otherwise a script on a
 * listed site could read the admin API with an editor's session cookie.
 */
describe('CORS', () => {
  const database = useTestDatabase();

  describe('with no CORS_ORIGINS', () => {
    let app: TestApp['app'];
    beforeAll(async () => {
      ({ app } = await createTestApp(database.current));
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows no cross-origin reads at all', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: SITE } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      const options = await preflight(app, SITE, 'GET');
      expect(options.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('with CORS_ORIGINS set', () => {
    let app: TestApp['app'];
    beforeAll(async () => {
      ({ app } = await createTestApp(database.current, {
        env: { CORS_ORIGINS: `${SITE},https://app.example` },
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows listed origins without credentials', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: SITE } });
      expect(response.headers['access-control-allow-origin']).toBe(SITE);
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.headers.vary).toMatch(/origin/i);
    });

    it('lets browser apps send the methods the delivery API uses (app-user updates and deletes)', async () => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const response = await preflight(app, SITE, method);
        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe(SITE);
        expect(String(response.headers['access-control-allow-methods'])).toContain(method);
        expect(String(response.headers['access-control-allow-headers'])).toMatch(/authorization/i);
        expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      }
    });

    it('ignores origins that are not listed', async () => {
      const evil = 'https://evil.example';
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: evil } });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect((await preflight(app, evil, 'PUT')).headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
