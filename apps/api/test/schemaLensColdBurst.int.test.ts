import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LENS_APP_USER_BUILDS_PER_MINUTE, resetLensBuildBudgets } from '../src/schema/lens/budget.js';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** More concurrent requests than an app user's lens build budget holds. */
const BURST = LENS_APP_USER_BUILDS_PER_MINUTE * 2;

/**
 * A cold burst of requests naming one older schema version (review 6, LOW): the first requests of a process
 * arrive together, each read the history backfill job, and each that saw it finished started caches of its
 * own, so every request missed and drew a build from the caller's budget. Past the budget they answered
 * `LENS_BUDGET_EXCEEDED`, and the caches left in place could be those of a refused request (empty), so the
 * caller stayed refused until its budget refilled. The job read is now shared: the burst builds once.
 */
describe('schema lenses: a cold burst of one version', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let page: ModelBody;
  let reader: AppSessionBody;
  let v0: string;

  const statusesOf = (responses: ReadonlyArray<Awaited<ReturnType<TestApp['app']['inject']>>>) =>
    responses.map((response) =>
      response.statusCode >= 400
        ? `${response.statusCode} ${response.json<{ error: { code: string } }>().error.code}`
        : String(response.statusCode),
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    const adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    v0 = expectStatus(
      await testApp.app.inject({ method: 'GET', url: '/api/snapshots/current', headers: bearer(adminToken) }),
      200,
    ).json<{ schemaVersionToken: string }>().schemaVersionToken;
    const current = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${page.definition.id}`, {
        definition: {
          ...current.definition,
          fields: current.definition.fields.map((field) =>
            field.apiKey === 'title' ? { ...field, apiKey: 'heading' } : field,
          ),
        },
        expectedVersion: current.version,
        acknowledgeBreaking: true,
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
    expectStatus(await admin.post('/api/admin/content/page', { data: { heading: 'x' }, publish: true }), 201);
    reader = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${reader.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [{ action: 'read', modelId: page.definition.id }]),
          ],
        },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('answers every request of the burst and every one after it, building the version once', async () => {
    clearLensCaches();
    resetLensBuildBudgets();
    const read = () =>
      testApp.app.inject({
        method: 'GET',
        url: `/api/content/pages?schemaVersion=${encodeURIComponent(v0)}`,
        headers: bearer(reader.accessToken),
      });
    const burst = await Promise.all(Array.from({ length: BURST }, read));
    expect(statusesOf(burst)).toEqual(Array.from({ length: BURST }, () => '200'));
    // Read through the old version: the renamed field under its old API ID.
    expect(burst[0]?.json<{ data: Array<{ title: string }> }>().data).toEqual([
      expect.objectContaining({ title: 'x' }),
    ]);
    const after = [];
    for (let index = 0; index < 4; index += 1) {
      after.push(await read());
    }
    expect(statusesOf(after)).toEqual(['200', '200', '200', '200']);
    // Warm now: a second burst is all cache hits, which cost nothing.
    expect(statusesOf(await Promise.all(Array.from({ length: BURST }, read)))).toEqual(
      Array.from({ length: BURST }, () => '200'),
    );
  });
});
