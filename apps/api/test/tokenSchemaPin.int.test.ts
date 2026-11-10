import type { RequestFn } from '@shapio/client';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import * as pinMigration from '../src/db/migrations/20261110130000_api_token_schema_pin.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { isSqliteRun } from './helpers/dialect.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type TokenView = {
  id: string;
  name: string;
  pinnedSchemaVersion: number | null;
  pinnedSchemaVersionAvailable: boolean;
};
type Delivered = { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
type ErrorBody = { error: { code: string; details?: Record<string, unknown> } };
type Reader = { principalKey: string; label: string | null; pinned: boolean; lastReadAt: string | null };
type Review = {
  olderClients: { versions: Array<{ schemaVersion: number; readers: Reader[] | null }> } | null;
};

/**
 * Pinning an API token to a schema version (plan schema-lenses): a request made with a pinned token that
 * names no version is served as if it had named the pin, on REST, GraphQL, the snapshot diff and the
 * contracts; a version the request names wins; writes follow the limited rules; usage records the effective
 * version, and a review lists a pinned token as an older client even before it reads.
 */
describe('schema lenses: tokens pinned to a schema version', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let first: EntryBody;
  let readRole: string;
  /** The version the old client was built against, as `<schemaId>:<version>` and as a number. */
  let v: string;
  let version: number;
  let current: string;

  const inject = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    credential: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    testApp.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${credential}`, ...headers },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const list = async (credential: string, query = '') =>
    expectStatus(await inject('GET', `/api/content/articles${query}`, credential), 200).json<Delivered>();
  const createToken = async (body: Record<string, unknown>) =>
    admin.post('/api/admin/tokens', { name: `Pinned ${Math.random()}`, roleId: readRole, ...body });
  const createPinned = async (pinnedSchemaVersion: number | null, roleId = readRole) => {
    const created = expectStatus(await createToken({ roleId, pinnedSchemaVersion }), 201).json<{
      token: string;
      apiToken: TokenView;
    }>();
    return { secret: created.token, view: created.apiToken };
  };
  const setPin = (id: string, pinnedSchemaVersion: unknown) =>
    admin.request({ method: 'PATCH', url: `/api/admin/tokens/${id}`, payload: { pinnedSchemaVersion } });
  const tokens = async () => expectStatus(await admin.get('/api/admin/tokens'), 200).json<TokenView[]>();
  const reload = async () =>
    expectStatus(await admin.get(`/api/admin/models/${article.definition.id}`), 200).json<ModelBody>();

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current, { env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'count', label: 'Count', type: 'integer' },
      ],
    });
    first = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'One', count: 3 }, publish: true }),
      201,
    ).json<EntryBody>();
    readRole = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id },
    ]);
    const probe = await createTokenForRole(database.current.db, readRole);
    v = (await inject('GET', '/api/content/articles', probe)).headers[
      'shapio-schema-version-current'
    ] as string;
    version = Number(v.split(':')[1]);
    // The schema moves on after the client was built: title is renamed, count becomes text.
    const before = await reload();
    const changed = await admin.put(`/api/admin/models/${before.definition.id}`, {
      definition: {
        ...before.definition,
        fields: before.definition.fields.map((field: FieldBody) => {
          if (field.apiKey === 'title') {
            return { ...field, apiKey: 'headline' };
          }
          const { editor: _editor, ...rest } = field;
          return { ...rest, type: 'string', settings: {} };
        }),
      },
      expectedVersion: before.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], changed.body).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
    current = (await inject('GET', '/api/content/articles', probe)).headers[
      'shapio-schema-version-current'
    ] as string;
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('validates the pin on create and update', async () => {
    const currentVersion = Number(current.split(':')[1]);
    for (const pinnedSchemaVersion of [0, -1, 1.5, currentVersion + 1]) {
      const refused = await createToken({ pinnedSchemaVersion });
      expect(refused.statusCode, String(pinnedSchemaVersion)).toBe(400);
      expect(refused.json<ErrorBody>().error.code).toBe('INVALID_PINNED_SCHEMA_VERSION');
    }
    expectStatus(await createToken({ pinnedSchemaVersion: 'one' }), 400);
    const { view } = await createPinned(null);
    expect(view).toMatchObject({ pinnedSchemaVersion: null, pinnedSchemaVersionAvailable: true });
    const ahead = await setPin(view.id, currentVersion + 1);
    expect(ahead.statusCode).toBe(400);
    expect(ahead.json<ErrorBody>().error.code).toBe('INVALID_PINNED_SCHEMA_VERSION');
    expect(
      expectStatus(await setPin(view.id, currentVersion), 200).json<TokenView>().pinnedSchemaVersion,
    ).toBe(currentVersion);
    expectStatus(await setPin('00000000-0000-4000-8000-000000000000', 1), 404);
  });

  it('reads the old shape over REST when the request names no version, and a named version wins', async () => {
    const { secret, view } = await createPinned(version);
    expect(view).toMatchObject({ pinnedSchemaVersion: version, pinnedSchemaVersionAvailable: true });
    const pinned = await list(secret);
    expect(pinned.data[0]).toMatchObject({ title: 'One', count: 3 });
    expect(pinned.data[0]).not.toHaveProperty('headline');
    expect(pinned.meta.schemaVersion).toEqual({ requested: v, current });
    const named = await list(secret, `?schemaVersion=${encodeURIComponent(current)}`);
    expect(named.data[0]).toMatchObject({ headline: 'One', count: '3' });
    // Clearing the pin reads today's shape.
    expectStatus(await setPin(view.id, null), 200);
    const cleared = await list(secret);
    expect(cleared.data[0]).toHaveProperty('headline', 'One');
    expect(cleared.meta).not.toHaveProperty('schemaVersion');
  });

  it('pins GraphQL, the snapshot diff and the contracts', async () => {
    const { secret } = await createPinned(version);
    const auth = { authorization: `Bearer ${secret}` };
    const old = dataOf(await graphql(testApp.app, '{ articles { nodes { title } } }', { headers: auth }));
    expect(old).toEqual({ articles: { nodes: [{ title: 'One' }] } });
    const today = dataOf(
      await graphql(testApp.app, '{ articles { nodes { headline } } }', {
        headers: { ...auth, 'shapio-schema-version': current },
      }),
    );
    expect(today).toEqual({ articles: { nodes: [{ headline: 'One' }] } });

    const diff = expectStatus(await inject('GET', '/api/snapshots/changes?from=0', secret), 200);
    const namedDiff = expectStatus(
      await inject('GET', `/api/snapshots/changes?from=0&schemaVersion=${encodeURIComponent(v)}`, secret),
      200,
    );
    expect(diff.json()).toStrictEqual(namedDiff.json());
    expect(diff.headers['shapio-schema-version-current']).toBe(current);

    const { secret: adminSecret, view: adminView } = await createPinned(
      version,
      await createRole(database.current.db, 'admin', [{ action: 'read', modelId: article.definition.id }]),
    );
    expect(adminView.pinnedSchemaVersion).toBe(version);
    const types = expectStatus(await inject('GET', '/api/docs/typescript', adminSecret), 200).json<{
      source: string;
    }>();
    expect(types.source).toContain(`export const SCHEMA_VERSION = '${v}' as const;`);
    expect(types.source).toMatch(/\btitle\??:/);
    expect(types.source).not.toMatch(/\bheadline\??:/);
  });

  it('writes through the pin with the limited rules, over REST and GraphQL', async () => {
    const writeRole = await createRole(database.current.db, 'admin', [
      { action: 'read', modelId: article.definition.id },
      { action: 'update', modelId: article.definition.id },
    ]);
    const { secret } = await createPinned(version, writeRole);
    const entryVersion = async () =>
      expectStatus(await admin.get(`/api/admin/content/article/${first.id}`), 200).json<EntryBody>().version;
    const refused = await inject('PUT', `/api/content/articles/${first.id}`, secret, {
      expectedVersion: await entryVersion(),
      data: { count: 4 },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json<ErrorBody>().error.code).toBe('LENS_WRITE_UNSUPPORTED');
    expectStatus(
      await inject('PUT', `/api/content/articles/${first.id}`, secret, {
        expectedVersion: await entryVersion(),
        data: { title: 'Uno' },
      }),
      200,
    );
    expect(
      expectStatus(await admin.get(`/api/admin/content/article/${first.id}`), 200).json<EntryBody>().data,
    ).toMatchObject({ headline: 'Uno', count: '3' });
    const mutation = await graphql(
      testApp.app,
      'mutation ($id: ID!, $v: Int) { updateArticle(id: $id, expectedVersion: $v, data: { count: 5 }) { id } }',
      {
        headers: { authorization: `Bearer ${secret}` },
        variables: { id: first.id, v: await entryVersion() },
      },
    );
    expect(errorCodes(mutation), JSON.stringify(mutation.body)).toEqual(['LENS_WRITE_UNSUPPORTED']);
  });

  it('records the effective version in usage, says whether it is a pin, and audits the change', async () => {
    const { secret, view } = await createPinned(version);
    type Reader = { principalKey: string; schemaVersion: number; pinned: boolean };
    type Readers = { principals: Reader[] };
    const readerOf = async () =>
      expectStatus(await admin.get('/api/admin/usage/schema-versions'), 200)
        .json<Readers>()
        .principals.find((principal) => principal.principalKey === `token:${view.id}`);
    /**
     * Usage is recorded after the response and written by a flush; polls the real condition (flush, then
     * read the recorded reader) until it holds, never a fixed wait.
     */
    const expectReader = (expected: Partial<Reader>) =>
      vi.waitFor(
        async () => {
          await testApp.app.usage.flush();
          expect(await readerOf()).toMatchObject(expected);
        },
        { timeout: 10_000, interval: 50 },
      );
    await list(secret);
    await expectReader({ schemaVersion: version, pinned: true });
    await list(secret, `?schemaVersion=${encodeURIComponent(current)}`);
    await expectReader({ schemaVersion: Number(current.split(':')[1]), pinned: false });

    expectStatus(await setPin(view.id, null), 200);
    // Setting the same value again records nothing.
    expectStatus(await setPin(view.id, null), 200);
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('action', '=', 'api_token.update')
      .where('target_id', '=', view.id)
      .execute();
    expect(audit).toHaveLength(1);
    const metadata =
      typeof audit[0]?.metadata === 'string'
        ? (JSON.parse(audit[0].metadata) as unknown)
        : audit[0]?.metadata;
    expect(metadata).toMatchObject({ pinnedSchemaVersion: { from: version, to: null } });
  });

  it('lists a pinned token that has not read yet as an older client in a review', async () => {
    const { view } = await createPinned(version);
    const proposed = await reload();
    const set = expectStatus(await admin.post('/api/admin/change-sets', { title: 'Drop count' }), 201).json<{
      id: string;
    }>();
    expectStatus(
      await admin.put(`/api/admin/change-sets/${set.id}/schema/${proposed.definition.id}`, {
        category: 'model',
        definition: {
          ...proposed.definition,
          fields: proposed.definition.fields.filter((field: FieldBody) => field.apiKey !== 'count'),
        },
        baseVersion: proposed.version,
      }),
      200,
    );
    const review = expectStatus(
      await admin.get(`/api/admin/change-sets/${set.id}/review`),
      200,
    ).json<Review>();
    const readers = review.olderClients?.versions.find((entry) => entry.schemaVersion === version)?.readers;
    expect(readers).toContainEqual(
      expect.objectContaining({ principalKey: `token:${view.id}`, pinned: true, lastReadAt: null }),
    );
  });

  describe.skipIf(isSqliteRun())('in-process delivery', () => {
    let runtime: DeliveryRuntime;

    beforeAll(async () => {
      await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
      runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
    });
    afterAll(async () => {
      await runtime?.close();
    });

    it('follows a pin change on the next call, with no restart', async () => {
      const { secret, view } = await createPinned(null);
      const local: RequestFn = createInProcessRequest(runtime, { token: secret });
      const read = async () => (await local<Delivered>('/api/content/articles')).data[0];
      expect(await read()).toHaveProperty('headline');
      expectStatus(await setPin(view.id, version), 200);
      const pinned = await read();
      expect(pinned).toHaveProperty('title');
      expect(pinned).not.toHaveProperty('headline');
      expectStatus(await setPin(view.id, null), 200);
      expect(await read()).toHaveProperty('headline');
    });
  });

  it('flags a pin the history does not reach, and its reads answer 409', async () => {
    const { secret, view } = await createPinned(version);
    const { db } = database.current;
    // History from before the pinned version is lost: the model's first row goes, the next is a backfill.
    const rows = await db
      .selectFrom('schema_activations')
      .select(['schema_version'])
      .where('model_id', '=', article.definition.id)
      .orderBy('schema_version')
      .execute();
    const [earliest, next] = rows;
    expect(next).toBeDefined();
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', article.definition.id)
      .where('schema_version', '<=', version)
      .execute();
    await db
      .updateTable('schema_activations')
      .set({ backfilled: true })
      .where('model_id', '=', article.definition.id)
      .execute();
    clearLensCaches();
    expect(earliest?.schema_version).toBeLessThanOrEqual(version);
    const listed = (await tokens()).find((token) => token.id === view.id);
    expect(listed).toMatchObject({ pinnedSchemaVersion: version, pinnedSchemaVersionAvailable: false });
    const refused = await inject('GET', '/api/content/articles', secret);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ErrorBody>().error.code).toBe('SCHEMA_VERSION_UNAVAILABLE');
  });

  it('migrates down and up', async () => {
    const migrationDb = database.current.db as unknown as Kysely<unknown>;
    await pinMigration.down(migrationDb);
    await pinMigration.up(migrationDb);
    const row = await database.current.db
      .selectFrom('api_tokens')
      .select('pinned_schema_version')
      .limit(1)
      .executeTakeFirst();
    expect(row).toEqual({ pinned_schema_version: null });
  });
});
