import { ShapioApiError, type RequestFn } from '@shapio/client';
import { SEO_COMPONENT_ID } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  ShapioVersionSkewError,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import { hashToken } from '../src/helpers/tokens.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import {
  createDefinition,
  createDeliveryToken,
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { createPng, uploadAsset } from './helpers/media.js';
import { createRoleToken, runSchemaJobs, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Answer = { status: number; body: unknown };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * In-process delivery (plan next-in-process §2): the same reads as the HTTP API, called as functions with the
 * same permissions, shapes and errors; a model change shows on the next call; a release mismatch is refused;
 * only delivery tokens (or none) read.
 */
const skipReason = dialectSkipReason(import.meta.url);

describe.skipIf(skipReason !== undefined)(withSkipReason('in-process delivery', skipReason), () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let article: ModelBody;
  let token: string;
  let runtime: DeliveryRuntime;
  let local: RequestFn;
  let anonymous: RequestFn;
  const ids: Record<string, string> = {};

  const http = async (path: string, credential: string | null = token): Promise<Answer> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: path,
      headers: credential ? bearer(credential) : {},
    });
    return { status: response.statusCode, body: response.json() };
  };

  const inProcess = async (request: RequestFn, path: string): Promise<Answer> => {
    try {
      return { status: 200, body: await request(path) };
    } catch (error) {
      if (!(error instanceof ShapioApiError)) {
        throw error;
      }
      const details = error.details === undefined ? {} : { details: error.details };
      return {
        status: error.status,
        body: { error: { code: error.code, message: error.message, ...details } },
      };
    }
  };

  const create = async (modelKey: string, data: Record<string, unknown>, publish = true) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish }),
      201,
    ).json<EntryBody>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expectStatus(await admin.post('/api/admin/components/builtin/seo/ensure', {}), 201);
    const cover = await uploadAsset(testApp.app, bearer(adminToken), {
      file: await createPng(30, 20),
      filename: 'cover.png',
      mimeType: 'image/png',
    });
    const author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
        { apiKey: 'secret', label: 'Secret', type: 'string', public: false },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
        { apiKey: 'seo', label: 'SEO', type: 'component', settings: { component: SEO_COMPONENT_ID } },
      ],
    });
    const home = await createDefinition(admin, {
      kind: 'singleton',
      apiKey: 'home',
      label: 'Home',
      fields: [{ apiKey: 'headline', label: 'Headline', type: 'string' }],
    });
    const ada = await create('author', { name: 'Ada' });
    ids.first = (
      await create('article', {
        title: 'First',
        secret: 'not for delivery',
        body: {
          format: 'shapio-richtext',
          version: 1,
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
        },
        cover: cover.id,
        author: ada.id,
      })
    ).id;
    ids.second = (await create('article', { title: 'Second', seo: { title: 'Custom title' } })).id;
    ids.draft = (await create('article', { title: 'Draft only' }, false)).id;
    await create('home', { headline: 'Welcome' });
    const current = expectStatus(await admin.get('/api/admin/site/seo'), 200).json<{ version: number }>();
    expectStatus(
      await admin.put('/api/admin/site/seo', {
        expectedVersion: current.version,
        seo: { locales: { en: { siteName: 'Northwind' } }, imageId: cover.id, twitterHandle: '@northwind' },
      }),
      200,
    );
    token = await createDeliveryToken(database.current.db, [
      { modelId: article.definition.id },
      { modelId: author.definition.id },
      { modelId: home.definition.id },
    ]);

    // What `shapio start` does after migrating.
    await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
    runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
    local = createInProcessRequest(runtime, { token });
    anonymous = createInProcessRequest(runtime, {});
  });

  afterAll(async () => {
    await runtime?.close();
    await testApp.app.close();
  });

  it('answers every delivery read exactly as the HTTP API does', async () => {
    const { body } = await http('/api/content/articles');
    const { snapshot } = (body as { meta: { snapshot: number } }).meta;
    const paths = [
      '/api/content/articles',
      '/api/content/articles?sort=title:desc&page=1&pageSize=1',
      '/api/content/articles?populate=author&fields=title&fields=author',
      '/api/content/articles?richText=html&seo=resolved',
      '/api/content/articles?filters[title][$eq]=Second',
      `/api/content/articles/${ids.first}`,
      `/api/content/articles/${ids.first}?snapshot=${snapshot}&populate=author`,
      `/api/content/articles?snapshot=${snapshot}`,
      '/api/content/home',
      '/api/site',
      '/api/snapshots/current',
      '/api/snapshots/changes?from=0',
      '/api/content/articles?site=default',
      // Errors carry the same status and body.
      `/api/content/articles/${ids.draft}`,
      '/api/content/articles/00000000-0000-4000-8000-000000000000',
      '/api/content/missing',
      '/api/content/articles?filters[secret][$eq]=x',
      '/api/content/articles?fields=secret',
      `/api/content/articles?snapshot=${snapshot + 1000}`,
      `/api/content/articles/${ids.first}?page=2`,
      '/api/snapshots/changes?from=-1',
      '/api/content/articles?site=nowhere',
    ];
    for (const path of paths) {
      expect(await inProcess(local, path), path).toStrictEqual(await http(path));
    }
    for (const path of ['/api/content/articles', '/api/site', '/api/content/home']) {
      expect(await inProcess(anonymous, path), `anonymous ${path}`).toStrictEqual(await http(path, null));
    }
  });

  it('reads drafts in process with a token granted Read drafts, and refuses them otherwise', async () => {
    const draftsToken = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [
        { action: 'read', modelId: null },
        { action: 'readDrafts', modelId: null },
      ]),
    );
    const drafts = createInProcessRequest(runtime, { token: draftsToken });
    for (const path of [
      '/api/content/articles?publicationState=draft&populate=author',
      `/api/content/articles/${ids.draft}?publicationState=draft`,
    ]) {
      expect(await inProcess(drafts, path), path).toStrictEqual(await http(path, draftsToken));
    }
    const list = await drafts<{ data: Array<{ title: string }>; meta: { publicationState?: string } }>(
      '/api/content/articles?publicationState=draft',
    );
    expect(list.data.map((entry) => entry.title)).toContain('Draft only');
    expect(list.meta.publicationState).toBe('draft');
    const refused = await inProcess(local, '/api/content/articles?publicationState=draft');
    expect(refused).toStrictEqual(await http('/api/content/articles?publicationState=draft'));
    expect(refused.status).toBe(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe('DRAFTS_FORBIDDEN');
    const anonymousRefused = await inProcess(anonymous, '/api/content/articles?publicationState=draft');
    expect(anonymousRefused.status).toBeGreaterThanOrEqual(401);
    expect(JSON.stringify(anonymousRefused.body)).not.toContain('Draft only');
  });

  it('serves published content only, with media URLs as the server builds them', async () => {
    const list = await local<{ data: Array<Record<string, unknown>> }>('/api/content/articles');
    expect(list.data.map((entry) => entry.title).sort()).toEqual(['First', 'Second']);
    expect(JSON.stringify(list)).not.toContain('Draft only');
    expect(JSON.stringify(list)).not.toContain('not for delivery');
    const first = list.data.find((entry) => entry.id === ids.first) as { cover: { url: string } };
    expect(
      first.cover.url.startsWith(
        `${testApp.config.server.publicUrl}${testApp.config.server.basePath}/api/media/`,
      ),
    ).toBe(true);
  });

  it('shows a model change on the next call, without a restart', async () => {
    const model = (await admin.get(`/api/admin/models/${article.definition.id}`)).json<ModelBody>();
    const response = await admin.put(`/api/admin/models/${article.definition.id}`, {
      definition: {
        ...model.definition,
        fields: [...model.definition.fields, { apiKey: 'subtitle', label: 'Subtitle', type: 'string' }],
      },
      expectedVersion: model.version,
    });
    expect([200, 202], response.body).toContain(response.statusCode);
    if (response.statusCode === 202) {
      await runSchemaJobs(database.current.db);
    }
    const entry = (await admin.get(`/api/admin/content/article/${ids.second}`)).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/article/${ids.second}`, {
        expectedVersion: entry.version,
        data: { ...entry.data, subtitle: 'Added live' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/article/${ids.second}/publish`, {}), 200);
    const { data } = await local<{
      data: Record<string, unknown>;
    }>(`/api/content/articles/${ids.second}`);
    expect(data.subtitle).toBe('Added live');
    expect(await inProcess(local, `/api/content/articles/${ids.second}`)).toStrictEqual(
      await http(`/api/content/articles/${ids.second}`),
    );
  });

  it('refuses admin API tokens, and a delivery token once it is revoked or expired', async () => {
    const asAdmin = createInProcessRequest(runtime, { token: adminToken });
    await expect(asAdmin('/api/content/articles')).rejects.toMatchObject({
      status: 403,
      code: 'DELIVERY_TOKEN_REQUIRED',
    });
    const short = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
    const reader = createInProcessRequest(runtime, { token: short });
    await expect(reader('/api/content/articles')).resolves.toBeDefined();
    await database.current.db
      .updateTable('api_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', hashToken(short))
      .execute();
    await expect(reader('/api/content/articles')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_TOKEN',
    });
    const expiring = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
    const setExpiry = (expiresAt: Date) =>
      database.current.db
        .updateTable('api_tokens')
        .set({ expires_at: expiresAt })
        .where('token_hash', '=', hashToken(expiring))
        .execute();
    const timed = createInProcessRequest(runtime, { token: expiring });
    await setExpiry(new Date(Date.now() + 60_000));
    await expect(timed('/api/content/articles')).resolves.toBeDefined();
    await setExpiry(new Date(Date.now() - 1000));
    await expect(timed('/api/content/articles')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_TOKEN',
    });
    await expect(
      createInProcessRequest(runtime, { token: 'shp_unknown' })('/api/site'),
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_TOKEN',
    });
  });

  it('answers nothing but delivery reads', async () => {
    for (const [method, path] of [
      ['GET', '/api/admin/content/article'],
      ['POST', '/api/content/articles'],
      ['GET', '/api/preview/content/articles/1'],
      ['GET', '/api/graphql?query=%7B__typename%7D'],
    ] as const) {
      await expect(local(path, { method }), `${method} ${path}`).rejects.toMatchObject({
        status: 404,
        code: 'NOT_AVAILABLE_IN_PROCESS',
      });
    }
  });

  it('refuses to read across releases', async () => {
    const setRelease = (release: string | null) =>
      database.current.db.updateTable('system_versions').set({ release }).execute();
    try {
      await setRelease('0.0.0-other');
      const refusal = local('/api/content/articles');
      await expect(refusal).rejects.toBeInstanceOf(ShapioVersionSkewError);
      await expect(refusal).rejects.toMatchObject({
        status: 503,
        code: 'VERSION_SKEW',
        serverRelease: '0.0.0-other',
        libraryRelease: SHAPIO_VERSION,
      });
      await setRelease(null);
      await expect(anonymous('/api/site')).rejects.toMatchObject({
        code: 'VERSION_SKEW',
        serverRelease: null,
      });
    } finally {
      await setRelease(SHAPIO_VERSION);
    }
    await expect(local('/api/site')).resolves.toBeDefined();
  });

  it('keeps hidden fields hidden for a token that may not read them', async () => {
    const titleOnly = await createDeliveryToken(database.current.db, [
      { modelId: article.definition.id, fieldIds: [fieldIdOf(article, 'title')] },
    ]);
    const reader = createInProcessRequest(runtime, { token: titleOnly });
    const path = `/api/content/articles/${ids.first}`;
    expect(await inProcess(reader, path)).toStrictEqual(await http(path, titleOnly));
    const { data } = await reader<{ data: Record<string, unknown> }>(path);
    expect(Object.keys(data)).not.toContain('cover');
  });

  it("reads over HTTP during a release mismatch with onVersionSkew: 'http'", async () => {
    await runtime.close();
    const address = await testApp.app.listen({ port: 0, host: '127.0.0.1' });
    runtime = createDeliveryRuntime({
      databaseUrl: database.current.url,
      poolMax: 2,
      onVersionSkew: 'http',
      fallbackUrl: address,
      logger: silentLogger,
    });
    const reader = createInProcessRequest(runtime, { token });
    const expected = await inProcess(reader, '/api/content/articles');
    try {
      await database.current.db.updateTable('system_versions').set({ release: '0.0.0-other' }).execute();
      expect(await inProcess(reader, '/api/content/articles')).toStrictEqual(expected);
    } finally {
      await database.current.db.updateTable('system_versions').set({ release: SHAPIO_VERSION }).execute();
    }
  });
});
