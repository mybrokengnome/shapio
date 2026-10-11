import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAppUser, setPublicGrants } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { GRAPHQL_ENV, graphql } from './helpers/graphql.js';
import { createLogCapture, type LogCapture } from './helpers/logCapture.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const NUL = 'a\u0000b';
const LONE = 'lone \ud800 surrogate';

/**
 * A NUL character or an unpaired surrogate is refused as 422 INVALID_TEXT wherever it arrives (no database
 * stores them as is; PostgreSQL answered with internal errors, SQLite stored them).
 */
describe('text no database can store', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let logs: LogCapture;
  let admin: SchemaClient;
  let thing: ModelBody;

  beforeAll(async () => {
    logs = createLogCapture();
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      logger: logs.logger,
      env: GRAPHQL_ENV,
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db, 'owner'));
    thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'thing',
      label: 'Thing',
      draftAndPublish: false,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        { apiKey: 'meta', label: 'Meta', type: 'json' },
      ],
    });
    await setPublicGrants(database.current.db, [
      { action: 'read', modelId: thing.definition.id },
      { action: 'create', modelId: thing.definition.id },
    ]);
    expectStatus(await admin.post('/api/admin/content/thing', { data: { title: 'kept' } }), 201);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const expectInvalidText = (response: LightMyRequestResponse, path: string) => {
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_TEXT', details: { path } } });
  };
  const anonymous = (url: string, method: 'GET' | 'POST' = 'GET', payload?: object) =>
    testApp.app.inject({ method, url, ...(payload ? { payload } : {}) });

  it('refuses it in admin saves, also as a JSON key and as a lone surrogate', async () => {
    expectInvalidText(
      await admin.post('/api/admin/content/thing', { data: { title: NUL } }),
      '/body/data/title',
    );
    expectInvalidText(
      await admin.post('/api/admin/content/thing', { data: { meta: { 'k\u0000': 'v' } } }),
      '/body/data/meta/k\u0000',
    );
    expectInvalidText(
      await admin.post('/api/admin/content/thing', { data: { title: LONE } }),
      '/body/data/title',
    );
  });

  it('refuses it in anonymous delivery filters, search, writes, and GraphQL', async () => {
    expectInvalidText(
      await anonymous('/api/content/things?filters[title][$eq]=a%00b'),
      '/query/filters[title][$eq]',
    );
    expectInvalidText(
      await anonymous('/api/content/things?filters[title][$containsi]=%00'),
      '/query/filters[title][$containsi]',
    );
    expectInvalidText(await anonymous('/api/content/things?q=%00'), '/query/q');
    expectInvalidText(
      await anonymous('/api/content/things', 'POST', { data: { title: NUL } }),
      '/body/data/title',
    );

    const literal = await graphql(
      testApp.app,
      '{ things(filter: { title: { eq: "a\\u0000b" } }) { totalCount } }',
    );
    expect(literal.body.errors?.[0]?.extensions?.code).toBe('INVALID_TEXT');
    const variables = await graphql(
      testApp.app,
      'query ($t: String) { things(filter: { title: { eq: $t } }) { totalCount } }',
      { variables: { t: NUL } },
    );
    expect(variables.statusCode).toBe(422);
    const valid = await graphql(testApp.app, '{ things(filter: { title: { eq: "kept" } }) { totalCount } }');
    expect(valid.body.errors).toBeUndefined();
    const overGet = await graphql(
      testApp.app,
      'query ($t: String) { things(filter: { title: { eq: $t } }) { totalCount } }',
      { variables: { t: NUL }, method: 'GET' },
    );
    expect(overGet.statusCode).toBe(422);
    // Ordinary values still work.
    const ok = expectStatus(await anonymous('/api/content/things?filters[title][$eq]=kept'), 200);
    expect(ok.json<{ data: EntryBody[] }>().data).toHaveLength(1);
  });

  it('refuses it in app-user sign-up, locales, and model labels', async () => {
    expectInvalidText(await registerAppUser(testApp.app, { name: NUL }), '/body/name');
    expectInvalidText(
      await admin.post('/api/admin/locales', { code: 'nl', label: 'Dutch\u0000' }),
      '/body/label',
    );
    expectInvalidText(
      await admin.post('/api/admin/models', {
        definition: { kind: 'collection', apiKey: 'other', label: LONE, fields: [] },
      }),
      '/body/definition/label',
    );
  });

  it('never logs an internal error for it', () => {
    expect(logs.lines.filter((line) => (JSON.parse(line) as { level: number }).level >= 50)).toEqual([]);
  });
});
