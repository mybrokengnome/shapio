import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_CONTENT_PORTS } from '../src/schema/planner/contentPorts.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Locale = { code: string; label: string; isDefault: boolean; fallbacks: string[] };

describe('locales API', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  const headsPerLocale: Record<string, number> = {};

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      schemaContent: {
        ...NO_CONTENT_PORTS,
        impact: { ...NO_CONTENT_PORTS.impact, countLocaleHeads: async (code) => headsPerLocale[code] ?? 0 },
      },
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const list = async () => (await admin.get('/api/admin/locales')).json<{ items: Locale[] }>().items;
  const schemaVersion = async () =>
    (await admin.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;

  it('starts with English as the default', async () => {
    expect(await list()).toEqual([{ code: 'en', label: 'English', isDefault: true, fallbacks: [] }]);
  });

  it('creates and updates locales, bumping the schema version each time', async () => {
    const version = await schemaVersion();
    const created = await admin.post('/api/admin/locales', {
      code: 'fr',
      label: 'French',
      fallbacks: ['en'],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await schemaVersion()).toBe(version + 1);
    expect(
      (await admin.post('/api/admin/locales', { code: 'de', label: 'German', fallbacks: ['xx'] })).statusCode,
    ).toBe(422);
    expect((await admin.post('/api/admin/locales', { code: 'fr', label: 'Again' })).statusCode).toBe(409);
    expect((await admin.post('/api/admin/locales', { code: 'Not a code', label: 'x' })).statusCode).toBe(400);
    const updated = await admin.put('/api/admin/locales/fr', { label: 'Français', fallbacks: ['en'] });
    expect(updated.json()).toMatchObject({ code: 'fr', label: 'Français', fallbacks: ['en'] });
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', 'fr')
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((row) => row.action)).toEqual(['locale.create', 'locale.update']);
  });

  it('changing the default locale is a contract change that needs acknowledgement', async () => {
    const refused = await admin.post('/api/admin/locales/fr/default', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      error: {
        code: 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED',
        details: { plan: { change: { category: 'contract', breaking: true } } },
      },
    });
    const accepted = await admin.post('/api/admin/locales/fr/default', { acknowledgeBreaking: true });
    expect(accepted.json()).toEqual({ code: 'fr', changed: true });
    expect((await list()).find((locale) => locale.isDefault)?.code).toBe('fr');
  });

  it('deleting a locale with content is destructive and needs acknowledgement; the default cannot be deleted', async () => {
    expect((await admin.delete('/api/admin/locales/fr')).statusCode).toBe(422);
    headsPerLocale.en = 3;
    const refused = await admin.delete('/api/admin/locales/en');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { details: { plan: { impact: { affectedHeads: 3 } } } } });
    const deleted = await admin.delete('/api/admin/locales/en?acknowledgeDestructive=true');
    expect(deleted.json()).toEqual({ code: 'en', affectedHeads: 3 });
    expect(await list()).toEqual([{ code: 'fr', label: 'Français', isDefault: true, fallbacks: [] }]);
    const purge = await database.current.db
      .selectFrom('jobs')
      .select('payload')
      .where('type', '=', 'schema.followUp')
      .execute();
    expect(purge.map((row) => row.payload)).toContainEqual({
      definitionId: null,
      steps: [{ kind: 'purgeLocale', code: 'en' }],
    });
  });

  it('needs schema.create to change locales', async () => {
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect((await editor.post('/api/admin/locales', { code: 'es', label: 'Spanish' })).statusCode).toBe(403);
  });
});
