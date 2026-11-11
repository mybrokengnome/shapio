import type { RequestFn } from '@shapio/client';
import { SEO_COMPONENT_ID } from '@shapio/schema';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import { bearer, setAuthenticatedGrants, setPublicGrants } from './helpers/appUsers.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { isSqliteRun } from './helpers/dialect.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
type Delivered = { data: Record<string, unknown> };

/**
 * Schema lenses and who may learn what (second review): nothing lens-specific before authorization (no lens
 * load, no build budget), history a version cannot serve answered 409, the null rule decided by grant shape,
 * lens-specific query answers only for callers that may know, SEO from lensed data, refusals naming only what
 * the caller sent.
 */
describe('schema lenses: authorization before anything lens-specific', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;
  let memo: ModelBody;
  let essay: ModelBody;
  let kid: ModelBody;
  let unrestrictedToken: string;
  let adminToken: string;
  let onlyAToken: string;
  let essayBlindToken: string;
  let entry: EntryBody;
  let v: string;

  const get = (url: string, credential: string | null) =>
    testApp.app.inject({
      method: 'GET' as InjectOptions['method'],
      url,
      headers: credential ? bearer(credential) : {},
    });
  const at = (url: string) => `${url}${url.includes('?') ? '&' : '?'}schemaVersion=${encodeURIComponent(v)}`;
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Record<string, unknown>,
  ) => {
    const current = (await admin.get(`/api/admin/models/${model.definition.id}`)).json<ModelBody>();
    const response = await admin.put(`/api/admin/models/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], response.body).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
    return (await admin.get(`/api/admin/models/${model.definition.id}`)).json<ModelBody>();
  };
  const publish = async (modelKey: string, data: Record<string, unknown>) => {
    const created = expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${created.id}/publish`, {}), 200);
    return created;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expectStatus(await admin.post('/api/admin/components/builtin/seo/ensure', {}), 201);
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    memo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'memo',
      label: 'Memo',
      fields: [
        { apiKey: 'headline', label: 'Headline', type: 'string', filterable: true },
        { apiKey: 'a', label: 'A', type: 'string', filterable: true },
        { apiKey: 'b', label: 'B', type: 'string', filterable: true },
        { apiKey: 'c', label: 'C', type: 'string' },
        { apiKey: 'gone', label: 'Gone', type: 'string', filterable: true },
        { apiKey: 'hiddenGone', label: 'Hidden gone', type: 'string', public: false, filterable: true },
        { apiKey: 'seo', label: 'SEO', type: 'component', settings: { component: SEO_COMPONENT_ID } },
      ],
    });
    essay = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'essay',
      pluralApiKey: 'essays',
      label: 'Essay',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const base = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'base',
      pluralApiKey: 'bases',
      label: 'Base',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    kid = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'kid',
      pluralApiKey: 'kids',
      label: 'Kid',
      extends: base.definition.id,
      fields: [],
    });
    const { db } = database.current;
    unrestrictedToken = await createTokenForRole(
      db,
      await createRole(
        db,
        'delivery',
        [author, memo, essay, base, kid].map((model) => ({
          action: 'read' as const,
          modelId: model.definition.id,
        })),
      ),
    );
    onlyAToken = await createTokenForRole(
      db,
      await createRole(db, 'delivery', [
        {
          action: 'read',
          modelId: memo.definition.id,
          fieldIds: [fieldIdOf(memo, 'headline'), fieldIdOf(memo, 'a'), fieldIdOf(memo, 'seo')],
        },
      ]),
    );
    await setPublicGrants(db, [{ action: 'read', modelId: author.definition.id }]);
    await setAuthenticatedGrants(db, []);
    await publish('author', { name: 'Ada' });
    entry = await publish('memo', {
      headline: 'Old headline',
      a: 'x',
      b: 'y',
      c: 'z',
      gone: 'g',
      hiddenGone: 'h',
    });
    await publish('essay', { title: 'An essay' });
    await publish('kid', { name: 'Kiddo' });

    v = expectStatus(await get('/api/snapshots/current', unrestrictedToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;

    // After the client's version: b and c made private, gone and hiddenGone removed, the headline removed.
    memo = await change(memo, (definition) => ({
      ...definition,
      fields: [
        field(definition, 'a'),
        { ...field(definition, 'b'), public: false },
        { ...field(definition, 'c'), public: false },
        field(definition, 'seo'),
      ],
    }));
    // `essays` names another type today, readable by a token that may not read essays.
    essay = await change(essay, (definition) => ({ ...definition, pluralApiKey: 'writings' }));
    const pamphlet = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'pamphlet',
      pluralApiKey: 'essays',
      label: 'Pamphlet',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    essayBlindToken = await createTokenForRole(
      db,
      await createRole(db, 'delivery', [{ action: 'read', modelId: pamphlet.definition.id }]),
    );
    // The kids' history is fine, their parent's before the version is lost: the kid cannot be served at V.
    await change(base, (definition) => ({ ...definition, label: 'Base (renamed)' }));
    // The kids' route moves too, so `bases/kids` is a key today's schema does not know.
    await change(kid, (definition) => ({ ...definition, label: 'Kid (renamed)', pluralApiKey: 'children' }));
    const version = Number(v.split(':')[1]);
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', base.definition.id)
      .where('schema_version', '<=', version)
      .execute();
    await db
      .updateTable('schema_activations')
      .set({ backfilled: true })
      .where('model_id', '=', base.definition.id)
      .execute();
    clearLensCaches();
    // Site SEO defaults that template the entry's title.
    const seo = expectStatus(await admin.get('/api/admin/site/seo'), 200).json<{ version: number }>();
    expectStatus(
      await admin.put('/api/admin/site/seo', {
        expectedVersion: seo.version,
        seo: { locales: { en: { titleTemplate: '%s · Acme' } }, imageId: null, twitterHandle: null },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('builds nothing for a caller that may not read: 100 versions, 100 no-version answers, budget untouched', async () => {
    const schemaId = v.split(':')[0] as string;
    const plain = await get('/api/content/memos', null);
    for (let version = 1; version <= 100; version += 1) {
      const response = await get(`/api/content/memos?schemaVersion=${schemaId}:${version}`, null);
      expect([response.statusCode, response.body], String(version)).toEqual([plain.statusCode, plain.body]);
    }
    // The same anonymous caller (same address) still reads an old version where it is allowed to.
    const allowed = await get(at('/api/content/authors'), null);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ meta: { schemaVersion?: unknown } }>().meta.schemaVersion).toBeTruthy();
  });

  it('answers 409 SCHEMA_VERSION_UNAVAILABLE over HTTP for a definition the version cannot serve', async () => {
    const response = await get(at('/api/content/bases/kids'), unrestrictedToken);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('SCHEMA_VERSION_UNAVAILABLE');
    // A caller that may not read the route gets what it gets without a version.
    const anonymous = await get(at('/api/content/bases/kids'), null);
    const plain = await get('/api/content/bases/kids', null);
    expect([anonymous.statusCode, anonymous.body]).toEqual([plain.statusCode, plain.body]);
  });

  // The field-restricted grant names every field that stays public (a, seo): its mask covers them all, yet it
  // named fields, so b and c (made private since) must not appear as null.
  it('names a definition the version cannot serve only to a caller that may read it today', async () => {
    // onlyA holds a grant on the workspace (memo) but none on kids: the old route key is a plain 404 to it.
    const blind = await get(at('/api/content/bases/kids'), onlyAToken);
    expect(blind.statusCode).toBe(404);
    expect(blind.json<ErrorBody>().error.code).toBe('MODEL_NOT_FOUND');
    const plain = await get('/api/content/bases/kids', onlyAToken);
    expect([blind.statusCode, blind.body]).toEqual([plain.statusCode, plain.body]);
  });

  it('answers a version it cannot read on the contract routes, and an empty one everywhere, after authorization', async () => {
    const schemaId = v.split(':')[0] as string;
    const docs = async (query: string, headers: Record<string, string> = {}) => {
      const response = await testApp.app.inject({
        method: 'GET',
        url: `/api/docs/typescript?${query}`,
        headers: { ...bearer(adminToken), ...headers },
      });
      return [response.statusCode, response.json<ErrorBody>().error?.code];
    };
    expect(await docs(`schemaVersion=${schemaId}:1&schemaVersion=${schemaId}:2`)).toEqual([
      400,
      'INVALID_QUERY',
    ]);
    expect(await docs(`schemaVersion=${schemaId}:1`, { 'shapio-schema-version': v })).toEqual([
      400,
      'SCHEMA_VERSION_MISMATCH',
    ]);
    expect(await docs('schemaVersion=')).toEqual([400, 'SCHEMA_VERSION_INVALID']);
    const empty = await get('/api/content/memos?schemaVersion=', unrestrictedToken);
    expect([empty.statusCode, empty.json<ErrorBody>().error.code]).toEqual([400, 'SCHEMA_VERSION_INVALID']);
    const anonymous = await get('/api/content/memos?schemaVersion=', null);
    const plain = await get('/api/content/memos', null);
    expect([anonymous.statusCode, anonymous.body]).toEqual([plain.statusCode, plain.body]);
  });

  it('reads fields made private since as null only for a grant that names no fields', async () => {
    const open = expectStatus(
      await get(at(`/api/content/memos/${entry.id}`), unrestrictedToken),
      200,
    ).json<Delivered>();
    expect(open.data).toMatchObject({ a: 'x', b: null, c: null });
    const onlyA = expectStatus(
      await get(at(`/api/content/memos/${entry.id}`), onlyAToken),
      200,
    ).json<Delivered>();
    expect(onlyA.data).toMatchObject({ a: 'x' });
    expect(onlyA.data).not.toHaveProperty('b');
    expect(onlyA.data).not.toHaveProperty('c');
  });

  it('gives lens-specific query answers only to callers that may know the field existed', async () => {
    const codeOf = async (url: string, credential: string) => {
      const response = await get(at(url), credential);
      return [response.statusCode, response.json<ErrorBody>().error.code];
    };
    // A grant naming no fields, a field public at the version: the lens's own answers.
    expect(await codeOf('/api/content/memos?filters[gone][$eq]=1', unrestrictedToken)).toEqual([
      400,
      'LENS_QUERY_UNSUPPORTED',
    ]);
    expect((await get(at('/api/content/memos?fields=gone'), unrestrictedToken)).statusCode).toBe(200);
    // A field private at the version, and a field-restricted grant: exactly the answer for a field that never
    // existed.
    const unknown = async (fieldName: string, credential: string) => {
      const response = await get(at(`/api/content/memos?filters[${fieldName}][$eq]=1`), credential);
      return [
        response.statusCode,
        response.json<ErrorBody>().error.code,
        response.json<ErrorBody>().error.message.replace(fieldName, '<f>'),
      ];
    };
    expect(await unknown('hiddenGone', unrestrictedToken)).toEqual(
      await unknown('neverWas', unrestrictedToken),
    );
    expect(await unknown('gone', onlyAToken)).toEqual(await unknown('neverWas', onlyAToken));
    const selectGone = await get(at('/api/content/memos?fields=gone'), onlyAToken);
    const selectNever = await get(at('/api/content/memos?fields=neverWas'), onlyAToken);
    expect([selectGone.statusCode, selectGone.json<ErrorBody>().error.code]).toEqual([
      selectNever.statusCode,
      selectNever.json<ErrorBody>().error.code,
    ]);
  });

  it('resolves SEO from what the lens reads, never a removed title field’s stored value', async () => {
    const resolved = expectStatus(
      await get(at(`/api/content/memos/${entry.id}?seo=resolved`), unrestrictedToken),
      200,
    );
    expect(resolved.body).not.toContain('Old headline');
  });

  it('answers a route key reused since with a plain 404 to a caller that may not read what it named then', async () => {
    // `essays` named the essay at V and names the pamphlet today; the token reads only pamphlets. In the version
    // it sent, the key names a type it may not read: a 404, which says nothing about the key's reuse.
    const response = await get(at('/api/content/essays'), essayBlindToken);
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('MODEL_NOT_FOUND');
    expect(response.json<ErrorBody>().error.message).toContain('"essays"');
    expect(response.body).not.toContain('"essay"');
    // Without a version, the same key reads today's pamphlets.
    expect((await get('/api/content/essays', essayBlindToken)).statusCode).toBe(200);
  });

  it('sends the current schema version only to callers authorized for the route', async () => {
    const header = 'shapio-schema-version-current';
    for (const url of ['/api/content/memos', at('/api/content/memos')]) {
      const allowed = await get(url, unrestrictedToken);
      expect([allowed.statusCode, typeof allowed.headers[header]], url).toEqual([200, 'string']);
      // No grant on the route (401/403), or an unknown route (404): no schema ID, no version counter.
      for (const [credential, status] of [
        [null, 401],
        [essayBlindToken, 403],
      ] as const) {
        const refused = await get(url, credential);
        expect([refused.statusCode, refused.headers[header]], url).toEqual([status, undefined]);
      }
      const unknown = await get(url.replace('memos', 'nothings'), unrestrictedToken);
      expect([unknown.statusCode, unknown.headers[header]]).toEqual([404, undefined]);
    }
    // An error answered only after authorization carries it.
    const unavailable = await get(at('/api/content/bases/kids'), unrestrictedToken);
    expect([unavailable.statusCode, typeof unavailable.headers[header]]).toEqual([409, 'string']);
  });

  describe.skipIf(isSqliteRun())('in-process delivery', () => {
    let runtime: DeliveryRuntime;
    let local: RequestFn;
    beforeAll(async () => {
      await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
      runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
      local = createInProcessRequest(runtime, {});
    });
    afterAll(async () => {
      await runtime?.close();
    });

    it('answers a caller that may not read as without a version, whatever version it names', async () => {
      const outcome = async (path: string) => {
        try {
          return await local(path);
        } catch (error) {
          return { status: (error as { status?: number }).status, body: (error as { body?: unknown }).body };
        }
      };
      const plain = await outcome('/api/content/memos');
      for (const query of [
        'schemaVersion=7',
        'schemaVersion=elsewhere:1',
        'schemaVersion=a:1&schemaVersion=a:2',
      ]) {
        expect(await outcome(`/api/content/memos?${query}`), query).toEqual(plain);
      }
    });
  });
});
