import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** Custom field editors from a project's shapio.config.js and extensions/editors (ADR 0009). */
describe('custom editor manifest', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let token: string;
  let projectDir: string;
  const MODULE = 'export const editor = { id: "acme.rating" };\n';
  // Building the app with a project config is quick locally but has exceeded 60s on a cold, busy CI runner.
  const SETUP_TIMEOUT_MS = 180_000;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'shapio-editors-'));
    mkdirSync(join(projectDir, 'extensions', 'editors'), { recursive: true });
    writeFileSync(join(projectDir, 'extensions', 'editors', 'rating.js'), MODULE);
    writeFileSync(join(projectDir, 'extensions', 'editors', 'unlisted.js'), MODULE);
    writeFileSync(
      join(projectDir, 'shapio.config.js'),
      'export const config = { editors: ["rating.js", "missing.js", "../secret.js"] };\n',
    );
    testApp = await createTestApp(database.current, { env: { BASE_PATH: '/cms' }, projectDir });
    token = await createRoleToken(testApp.db, 'editor');
  }, SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await testApp.app.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  const get = (url: string, auth = true) =>
    testApp.app.inject({
      method: 'GET',
      url,
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });

  it('lists only the configured editors that exist, with a content hash in the module path', async () => {
    const response = await get('/cms/api/admin/extensions/editors');
    expect(response.statusCode).toBe(200);
    const { items } = response.json<{ items: { file: string; path: string; hash: string }[] }>();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      file: 'rating.js',
      hash: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown,
    });
    expect(items[0]?.path).toBe(`/api/admin/extensions/editors/rating.js?v=${items[0]?.hash}`);
  });

  it('serves a listed module as JavaScript, and nothing that is not listed', async () => {
    const response = await get('/cms/api/admin/extensions/editors/rating.js?v=abc');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/javascript/);
    expect(response.body).toBe(MODULE);
    expect((await get('/cms/api/admin/extensions/editors/unlisted.js')).statusCode).toBe(404);
    expect((await get('/cms/api/admin/extensions/editors/..%2Fsecret.js')).statusCode).toBe(400);
  });

  it('requires an admin', async () => {
    expect((await get('/cms/api/admin/extensions/editors', false)).statusCode).toBe(401);
    expect((await get('/cms/api/admin/extensions/editors/rating.js', false)).statusCode).toBe(401);
  });
});
