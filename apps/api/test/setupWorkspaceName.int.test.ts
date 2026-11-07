import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { SYSTEM_CLI_ACTOR } from '../src/services/actorContext.js';
import { createSite, deleteSite, makePrimarySite } from '../src/services/sites.js';
import { TEST_PASSWORD } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** First-run setup can name the built-in workspace (code: site); its key `default` never changes. */
const postSetup = (testApp: TestApp, workspaceName?: string) =>
  testApp.app.inject({
    method: 'POST',
    url: '/api/admin/setup',
    payload: {
      email: 'owner@example.com',
      name: 'Owner',
      password: TEST_PASSWORD,
      ...(workspaceName === undefined ? {} : { workspaceName }),
    },
  });

const builtInRow = (testApp: TestApp) =>
  testApp.db
    .selectFrom('sites')
    .select(['key', 'name', 'version'])
    .where('id', '=', PRIMARY_SITE_ID)
    .executeTakeFirst();

const siteUpdateAudits = (testApp: TestApp) =>
  testApp.db
    .selectFrom('audit_events')
    .select(['actor_type', 'actor_id', 'target_type', 'target_id', 'metadata', 'request_id'])
    .where('action', '=', 'site.update')
    .execute();

const metadataOf = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

describe('setup with a workspace name', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: silentLogger });
  });
  afterAll(() => testApp.app.close());

  it('renames the built-in workspace, keeps its key, and audits the rename as the new owner', async () => {
    const before = await builtInRow(testApp);
    expect(before).toBeDefined();

    const response = await postSetup(testApp, '  Marketing  ');
    expect(response.statusCode).toBe(201);

    const after = await builtInRow(testApp);
    expect(after).toEqual({ key: before?.key, name: 'Marketing', version: (before?.version ?? 0) + 1 });

    const owner = await testApp.db.selectFrom('admin_users').select('id').executeTakeFirstOrThrow();
    const audits = await siteUpdateAudits(testApp);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: 'admin',
      actor_id: owner.id,
      target_type: 'site',
      target_id: PRIMARY_SITE_ID,
    });
    expect(audits[0]?.request_id).toBeTruthy();
    expect(metadataOf(audits[0]?.metadata)).toEqual({ name: { from: before?.name, to: 'Marketing' } });
  });
});

describe('setup without a workspace name', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: silentLogger });
  });
  afterAll(() => testApp.app.close());

  it('leaves the built-in workspace as it was', async () => {
    const before = await builtInRow(testApp);
    expect((await postSetup(testApp)).statusCode).toBe(201);
    expect(await builtInRow(testApp)).toEqual(before);
    expect(await siteUpdateAudits(testApp)).toEqual([]);
  });
});

describe('setup with a workspace name after the built-in workspace was deleted', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: silentLogger });
    // Another workspace takes over as primary, then the built-in one goes (the CLI can do this before setup).
    const other = await createSite(SYSTEM_CLI_ACTOR, { key: 'marketing', name: 'Marketing' }, testApp.db);
    await makePrimarySite(SYSTEM_CLI_ACTOR, { by: 'id', id: other.id }, testApp.db);
    await deleteSite(SYSTEM_CLI_ACTOR, PRIMARY_SITE_ID);
  });
  afterAll(() => testApp.app.close());

  it('skips the rename and still completes setup', async () => {
    expect(await builtInRow(testApp)).toBeUndefined();
    expect((await postSetup(testApp, 'Default workspace')).statusCode).toBe(201);
    expect(await siteUpdateAudits(testApp)).toEqual([]);
    const names = await testApp.db.selectFrom('sites').select('name').execute();
    expect(names).toEqual([{ name: 'Marketing' }]);
  });
});

describe('setup body validation', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: silentLogger });
  });
  afterAll(() => testApp.app.close());

  it('refuses an empty or over-long workspace name, like a rename from the network view', async () => {
    expect((await postSetup(testApp, '')).statusCode).toBe(400);
    expect((await postSetup(testApp, 'x'.repeat(201))).statusCode).toBe(400);
    expect(await testApp.db.selectFrom('admin_users').select('id').execute()).toEqual([]);
  });
});
