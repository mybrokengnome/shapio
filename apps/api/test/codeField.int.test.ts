import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type IntrospectedFields = {
  __type: { fields: Array<{ name: string; description: string | null }> } | null;
};
type OpenApi = { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } };
type PlanBody = { plan: { summary: { breaking: boolean; supported: boolean } } };

/** An HTML embed with leading and trailing whitespace, quotes, a tab and a CRLF: stored and served byte for byte. */
const SNIPPET =
  '  <script async src="https://embed.test/w.js" data-id=\'42\'></script>\r\n\t<p>Hi &amp; bye</p>\n';

/** The `code` data type (plan code-field): a string with a language, never indexed, converts to and from text. */
describe('code fields', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let reader: string;

  const create = (modelKey: string, data: Record<string, unknown>) =>
    admin.post(`/api/admin/content/${modelKey}`, { data });
  const publish = async (modelKey: string, id: string) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, {}), 200);
  const reload = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/models/${id}`), 200).json<ModelBody>();
  const withFields = (current: ModelBody, fields: unknown[]) => ({
    definition: { ...current.definition, fields },
    expectedVersion: current.version,
  });
  const retype = (current: ModelBody, apiKey: string, change: Record<string, unknown>) =>
    withFields(
      current,
      current.definition.fields.map((field) => (field.apiKey === apiKey ? { ...field, ...change } : field)),
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    reader = await createDeliveryToken(database.current.db, [{ modelId: null }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('stores and serves the exact string over REST and GraphQL, and names the language in the schema', async () => {
    const snippet = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'snippet',
      label: 'Snippet',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'embed', label: 'Embed', type: 'code', settings: { language: 'html' } },
        { apiKey: 'notes', label: 'Notes', type: 'code' },
      ],
    });
    const fields = snippet.definition.fields as unknown as Array<Record<string, unknown>>;
    expect(fields.find((field) => field.apiKey === 'embed')).toMatchObject({
      settings: { language: 'html' },
      editor: { id: 'codeEditor' },
    });
    // The language defaults to plain.
    expect(fields.find((field) => field.apiKey === 'notes')).toMatchObject({
      settings: { language: 'plain' },
    });

    const entry = expectStatus(
      await create('snippet', { title: 'Widget', embed: SNIPPET }),
      201,
    ).json<EntryBody>();
    expect(entry.data.embed).toBe(SNIPPET);
    await publish('snippet', entry.id);

    const rest = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/snippets/${entry.id}`,
        headers: { authorization: `Bearer ${reader}` },
      }),
      200,
    ).json<{ data: Record<string, unknown> }>();
    expect(rest.data.embed).toBe(SNIPPET);

    const headers = { authorization: `Bearer ${reader}` };
    const read = dataOf(
      await graphql<{ snippets: { nodes: Array<{ embed: string }> } }>(
        testApp.app,
        '{ snippets { nodes { embed } } }',
        { headers },
      ),
    );
    expect(read.snippets.nodes).toEqual([{ embed: SNIPPET }]);

    const introspected = dataOf(
      await graphql<IntrospectedFields>(
        testApp.app,
        '{ __type(name: "Snippet") { fields { name description } } }',
        { headers },
      ),
    );
    const descriptions = new Map(introspected.__type?.fields.map((field) => [field.name, field.description]));
    expect(descriptions.get('embed')).toBe('Embed\n\nCode: html');
    expect(descriptions.get('notes')).toBe('Notes\n\nCode: plain');
    expect(descriptions.get('title')).toBe('Title');

    const openapi = expectStatus(await admin.get('/api/docs/openapi.json'), 200).json<OpenApi>();
    const properties = openapi.components.schemas.Snippet?.properties ?? {};
    expect(JSON.stringify(properties.embed)).toContain('"x-shapio-language":"html"');
    expect(JSON.stringify(properties.embed)).toContain('"contentMediaType":"text/html"');
    expect(JSON.stringify(properties.notes)).not.toContain('contentMediaType');

    const { source } = expectStatus(await admin.get('/api/docs/typescript'), 200).json<{ source: string }>();
    expect(source).toContain('/** Embed (Code: html) */\n  embed: string | null;');
  });

  it('checks length, and JSON when validate is on, without rewriting the value', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'widgetConfig',
      label: 'Widget config',
      fields: [
        { apiKey: 'config', label: 'Config', type: 'code', settings: { language: 'json', validate: true } },
        { apiKey: 'raw', label: 'Raw', type: 'code', settings: { language: 'json', maxLength: 5 } },
      ],
    });
    const bad = await create('widgetConfig', { config: '{bad' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({
      error: { code: 'CONTENT_INVALID', details: { issues: [{ path: '/config', code: 'INVALID_FORMAT' }] } },
    });
    // Without validate, a JSON field takes any text.
    const good = expectStatus(await create('widgetConfig', { config: '{"ok":true}', raw: '{x' }), 201);
    expect(good.json<EntryBody>().data).toMatchObject({ config: '{"ok":true}', raw: '{x' });
    // Whitespace counts toward the length and is kept.
    expect(
      expectStatus(await create('widgetConfig', { config: ' [1] ' }), 201).json<EntryBody>().data.config,
    ).toBe(' [1] ');
    expect((await create('widgetConfig', { raw: '{ "a" }' })).json()).toMatchObject({
      error: { details: { issues: [{ path: '/raw', code: 'TOO_LONG' }] } },
    });
    expect((await create('widgetConfig', { raw: 12 })).json()).toMatchObject({
      error: { details: { issues: [{ path: '/raw', code: 'INVALID_TYPE' }] } },
    });
  });

  it.each(['unique', 'filterable', 'sortable'])('refuses %s on a code field', async (flag) => {
    const response = await admin.post('/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: `flagged${flag}`,
        label: 'Flagged',
        fields: [{ apiKey: 'body', label: 'Body', type: 'code', [flag]: true }],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'SCHEMA_INVALID',
        details: { issues: [{ path: `/fields/0/${flag}`, code: 'UNSUPPORTED_FLAG' }] },
      },
    });
  });

  it('text to code is breaking and keeps the value; code back to text is not breaking and keeps it', async () => {
    const block = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'block',
      label: 'Block',
      fields: [{ apiKey: 'markup', label: 'Markup', type: 'text' }],
    });
    const entry = expectStatus(await create('block', { markup: SNIPPET }), 201).json<EntryBody>();

    const toCode = retype(block, 'markup', {
      type: 'code',
      settings: { language: 'html' },
      editor: { id: 'codeEditor', options: {} },
    });
    const planned = expectStatus(
      await admin.post(`/api/admin/models/${block.definition.id}/plan`, toCode),
      200,
    );
    expect(planned.json<PlanBody>().plan.summary).toMatchObject({ breaking: true, supported: true });
    const changed = await admin.put(`/api/admin/models/${block.definition.id}`, {
      ...toCode,
      acknowledgeBreaking: true,
    });
    expect([200, 202]).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
    const asCode = await reload(block.definition.id);
    expect(asCode.definition.fields[0]).toMatchObject({ type: 'code', settings: { language: 'html' } });
    const read = () => admin.get(`/api/admin/content/block/${entry.id}`);
    expect(expectStatus(await read(), 200).json<EntryBody>().data.markup).toBe(SNIPPET);

    const toText = retype(asCode, 'markup', {
      type: 'text',
      settings: {},
      editor: { id: 'textarea', options: {} },
    });
    const back = expectStatus(await admin.post(`/api/admin/models/${block.definition.id}/plan`, toText), 200);
    expect(back.json<PlanBody>().plan.summary).toMatchObject({ breaking: false, supported: true });
    const reverted = await admin.put(`/api/admin/models/${block.definition.id}`, toText);
    expect([200, 202]).toContain(reverted.statusCode);
    await runContentSchemaJobs(database.current.db);
    expect((await reload(block.definition.id)).definition.fields[0]).toMatchObject({ type: 'text' });
    expect(expectStatus(await read(), 200).json<EntryBody>().data.markup).toBe(SNIPPET);
  });
});
