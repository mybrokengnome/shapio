import type { RequestFn } from '@shapio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import * as permissionsVersionRepository from '../src/repositories/permissionsVersion.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
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
import type { TestApp } from './helpers/createTestApp.js';
import { isSqliteRun } from './helpers/dialect.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Delivered = { data: Record<string, unknown>; meta: Record<string, unknown> };
type DeliveredList = { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
type ErrorBody = { error: { code: string } };

/** Delivered entries without what a conversion moves (timestamps), for before/after comparison. */
const withoutTimes = (entry: Record<string, unknown>) => {
  const { createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = entry;
  return rest;
};

/**
 * Schema lenses (plan schema-lenses, WP3): a client names the schema version it was built against and reads
 * today's content in that version's shape, over REST, preview, in-process delivery, the snapshot diff and the
 * generated contracts, with today's visibility (rule 7).
 */
describe('schema lenses', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let session: TestSession;
  let hero: ModelBody;
  let author: ModelBody;
  let article: ModelBody;
  let gadget: ModelBody;
  let promo: ModelBody;
  let token: string;
  let narrowRole: string;
  let narrowToken: string;
  let first: EntryBody;
  let writer: EntryBody;
  /** The schema version the "old client" was built against. */
  let v: string;
  /** What the old client read before any change. */
  let before: { list: DeliveredList; one: Delivered; filtered: DeliveredList; narrow: Delivered };
  let snapshotBefore: number;

  const get = (url: string, credential: string | null = token, headers: Record<string, string> = {}) =>
    testApp.app.inject({
      method: 'GET',
      url,
      headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...headers },
    });
  const json = async <T>(url: string, credential: string | null = token) =>
    expectStatus(await get(url, credential), 200).json<T>();
  const at = (url: string) => `${url}${url.includes('?') ? '&' : '?'}schemaVersion=${encodeURIComponent(v)}`;
  const createEntry = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish: true }),
      201,
    ).json<EntryBody>();
  const reload = async (model: ModelBody, kind: 'models' | 'components' = 'models') =>
    (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
  /** Applies a change to a definition and runs its jobs until it is live. */
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Record<string, unknown>,
    kind: 'models' | 'components' = 'models',
  ) => {
    const current = await reload(model, kind);
    const response = await admin.put(`/api/admin/${kind}/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      throw new Error(
        `Changing ${current.definition.apiKey} failed: ${response.statusCode} ${response.body}`,
      );
    }
    await runContentSchemaJobs(database.current.db);
    return reload(model, kind);
  };
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  /** A field with another type: its editor goes with the old type. */
  const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({ ...rest, type, settings: {} });
  const currentToken = async () =>
    (await json<{ schemaVersionToken: string }>('/api/snapshots/current')).schemaVersionToken;

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    session = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['editor'] }));
    hero = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string' },
        ],
      },
      'components',
    );
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
        { apiKey: 'count', label: 'Count', type: 'integer', filterable: true },
        { apiKey: 'price', label: 'Price', type: 'decimal' },
        { apiKey: 'summary', label: 'Summary', type: 'text', filterable: true },
        { apiKey: 'secret', label: 'Secret', type: 'string' },
        { apiKey: 'restricted', label: 'Restricted', type: 'string' },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: hero.definition.id } },
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    gadget = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'gadget',
      label: 'Gadget',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    promo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'promo',
      label: 'Promo',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const grants = [article, author, gadget, promo].map((model) => ({
      action: 'read' as const,
      modelId: model.definition.id,
    }));
    token = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', grants),
    );
    narrowRole = await createRole(database.current.db, 'delivery', [
      {
        action: 'read',
        modelId: article.definition.id,
        fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'restricted')],
      },
    ]);
    narrowToken = await createTokenForRole(database.current.db, narrowRole);

    writer = await createEntry('author', { name: 'Ada' });
    first = await createEntry('article', {
      title: 'First',
      count: 3,
      price: '12.5',
      summary: 'One',
      secret: 'shh',
      restricted: 'r1',
      hero: { heading: 'Hi', note: 'private soon' },
      writer: writer.id,
    });
    await createEntry('article', {
      title: 'Second',
      count: 5,
      price: '2',
      summary: 'Two',
      writer: writer.id,
    });
    await createEntry('gadget', { name: 'Widget' });

    v = await currentToken();
    snapshotBefore = (await json<{ snapshot: number }>('/api/snapshots/current')).snapshot;
    before = {
      list: await json<DeliveredList>(at('/api/content/articles?sort=title:asc')),
      one: await json<Delivered>(at(`/api/content/articles/${first.id}`)),
      filtered: await json<DeliveredList>(
        at('/api/content/articles?filters[title][$eq]=First&fields=title,summary&populate=writer'),
      ),
      narrow: await json<Delivered>(at(`/api/content/articles/${first.id}`), narrowToken),
    };

    // Everything an old client must survive.
    hero = await change(
      hero,
      (definition) => ({
        ...definition,
        fields: [
          { ...field(definition, 'heading'), apiKey: 'title' },
          { ...field(definition, 'note'), public: false },
        ],
      }),
      'components',
    );
    article = await change(article, (definition) => ({
      ...definition,
      pluralApiKey: 'posts',
      fields: [
        { ...field(definition, 'writer') },
        { ...field(definition, 'title'), apiKey: 'headline' },
        retype(field(definition, 'count'), 'string'),
        retype(field(definition, 'price'), 'number'),
        { ...field(definition, 'secret'), public: false },
        { ...field(definition, 'restricted') },
        { ...field(definition, 'hero') },
        { apiKey: 'subtitle', label: 'Subtitle', type: 'string', required: true, defaultValue: 'Sub' },
      ],
    }));
    expectStatus(
      await admin.delete(
        `/api/admin/models/${gadget.definition.id}?expectedVersion=${gadget.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
    promo = await change(promo, (definition) => ({
      ...definition,
      kind: 'singleton',
      pluralApiKey: undefined,
    }));
    // The narrow role loses `restricted` since the client's version.
    await database.current.db.transaction().execute(async (trx) => {
      await adminRolesRepository.deletePermissionsForRole(narrowRole, trx);
      await adminRolesRepository.insertPermissions(
        [
          {
            role_id: narrowRole,
            action: 'read',
            model_id: article.definition.id,
            condition: null,
            field_ids: [fieldIdOf(article, 'headline')],
          },
        ],
        trx,
      );
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('serves an old client exactly as before, except removed, hidden and converted fields', async () => {
    const list = await json<DeliveredList>(at('/api/content/articles?sort=title:asc'));
    const expected = before.list.data.map((entry) => {
      const { secret: _secret, summary: _summary, hero: heroValue, ...rest } = withoutTimes(entry);
      const heroShown =
        heroValue && typeof heroValue === 'object'
          ? (({ note: _note, ...shown }) => shown)(heroValue as Record<string, unknown>)
          : heroValue;
      return { ...rest, summary: null, hero: heroShown };
    });
    expect(list.data.map(withoutTimes)).toEqual(expected);
    // V's field order, V's names; nothing today's version added.
    expect(Object.keys(list.data[0] ?? {})).toEqual(
      Object.keys(before.list.data[0] ?? {}).filter((key) => key !== 'secret'),
    );
    expect(list.data[0]).toMatchObject({ title: 'First', count: 3, price: '12.5', hero: { heading: 'Hi' } });
    expect(JSON.stringify(list)).not.toMatch(/shh|private soon|headline|subtitle|Sub"/);
    expect(list.meta.schemaVersion).toEqual({ requested: v, current: await currentToken() });
  });

  it('answers today’s clients in today’s shape', async () => {
    const list = await json<DeliveredList>('/api/content/posts?sort=headline:asc');
    expect(list.data[0]).toMatchObject({ headline: 'First', count: '3', price: 12.5, subtitle: 'Sub' });
    expect(list.meta.schemaVersion).toBeUndefined();
    expect((await get('/api/content/articles')).statusCode).toBe(404);
  });

  it('takes filters, sorts, fields and populate in the old names', async () => {
    const filtered = await json<DeliveredList>(
      at('/api/content/articles?filters[title][$eq]=First&fields=title,summary&populate=writer'),
    );
    expect(filtered.data.map(withoutTimes)).toEqual(
      before.filtered.data.map((entry) => ({ ...withoutTimes(entry), summary: null })),
    );
    const sorted = await json<DeliveredList>(at('/api/content/articles?sort=title:desc&fields=title'));
    expect(sorted.data.map((entry) => entry.title)).toEqual(['Second', 'First']);
    for (const [query, code] of [
      ['filters[count][$eq]=3', 'LENS_QUERY_UNSUPPORTED'],
      ['filters[summary][$eq]=One', 'LENS_QUERY_UNSUPPORTED'],
      ['filters[headline][$eq]=First', 'INVALID_QUERY'],
    ] as const) {
      const refused = await get(at(`/api/content/articles?${query}`));
      expect(refused.statusCode).toBe(400);
      expect(refused.json<ErrorBody>().error.code).toBe(code);
    }
  });

  it('refuses a deleted model (404) and a kind change (409)', async () => {
    expect((await get(at('/api/content/gadgets'))).statusCode).toBe(404);
    const promoted = await get(at('/api/content/promos'));
    expect(promoted.statusCode).toBe(409);
    expect(promoted.json<ErrorBody>().error.code).toBe('LENS_UNCOVERED');
  });

  it('never shows what is not visible today (rule 7)', async () => {
    const one = await json<Delivered>(at(`/api/content/articles/${first.id}`));
    expect(one.data).not.toHaveProperty('secret');
    expect(one.data.hero).toEqual({ heading: 'Hi' });
    expect(JSON.stringify(one)).not.toMatch(/shh|private soon/);
    // A role that lost a field since the client's version does not see it through the lens.
    expect(before.narrow.data).toMatchObject({ title: 'First', restricted: 'r1' });
    const narrow = await json<Delivered>(at(`/api/content/articles/${first.id}`), narrowToken);
    expect(narrow.data).toMatchObject({ title: 'First' });
    expect(narrow.data).not.toHaveProperty('restricted');
    expect(JSON.stringify(narrow)).not.toContain('r1');
    // A private field cannot be filtered on through a lens either.
    expect((await get(at('/api/content/articles?filters[secret][$eq]=shh'))).statusCode).toBe(403);
    // A draft never shows.
    const draft = expectStatus(
      await admin.post('/api/admin/content/article', { data: { headline: 'Draft only' } }),
      201,
    ).json<EntryBody>();
    expect((await get(at(`/api/content/articles/${draft.id}`))).statusCode).toBe(404);
    expect(JSON.stringify(await json(at('/api/content/articles')))).not.toContain('Draft only');
    // Anonymous callers with no grant stay out.
    expect((await get(at('/api/content/articles'), null)).statusCode).toBe(401);
  });

  it('pairs with ?snapshot=N', async () => {
    const pinned = await json<DeliveredList>(
      at(`/api/content/articles?snapshot=${snapshotBefore}&sort=title:asc`),
    );
    expect(pinned.data.map((entry) => entry.title)).toEqual(['First', 'Second']);
    expect(pinned.data[0]).toMatchObject({ count: 3, price: '12.5', summary: null });
  });

  it('reads previews in the old shape', async () => {
    const { token: previewToken } = expectStatus(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/preview/tokens',
        headers: session.headers,
        payload: { modelKey: 'article', entryId: first.id },
      }),
      201,
    ).json<{ token: string }>();
    const preview = await json<Delivered>(at(`/api/preview/content/articles/${first.id}`), previewToken);
    expect(preview.data).toMatchObject({ title: 'First', count: 3, hero: { heading: 'Hi' } });
    expect(preview.data).not.toHaveProperty('secret');
    expect(preview.meta).toMatchObject({ preview: true, schemaVersion: { requested: v } });
  });

  it('names models in the old names in the snapshot diff, and leaves out models the old version lacks', async () => {
    const newcomer = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'newcomer',
      label: 'Newcomer',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const role = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id },
      { action: 'read', modelId: newcomer.definition.id },
    ]);
    const diffToken = await createTokenForRole(database.current.db, role);
    await createEntry('newcomer', { name: 'New' });
    type Diff = { items: Array<{ modelKey: string; routeKey: string }> };
    const today = await json<Diff>('/api/snapshots/changes?from=0', diffToken);
    expect(today.items.map((item) => item.routeKey).sort()).toEqual(['newcomers', 'posts', 'posts']);
    const old = await json<Diff>(at('/api/snapshots/changes?from=0'), diffToken);
    expect(old.items.map((item) => [item.modelKey, item.routeKey])).toEqual([
      ['article', 'articles'],
      ['article', 'articles'],
    ]);
  });

  it('checks the version it is given', async () => {
    const schemaId = v.split(':')[0] as string;
    const cases: Array<[string, Record<string, string>, string]> = [
      [
        `/api/content/articles?schemaVersion=${schemaId}:1`,
        { 'shapio-schema-version': v },
        'SCHEMA_VERSION_MISMATCH',
      ],
      [`/api/content/articles?schemaVersion=${schemaId}:99999999`, {}, 'SCHEMA_VERSION_AHEAD'],
      ['/api/content/articles?schemaVersion=elsewhere:1', {}, 'SCHEMA_VERSION_FOREIGN'],
      ['/api/content/articles?schemaVersion=7', {}, 'SCHEMA_VERSION_INVALID'],
    ];
    for (const [url, headers, code] of cases) {
      const response = await get(url, token, headers);
      expect(response.statusCode, code).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe(code);
    }
    // The header alone works too, and the same version in both places is fine.
    const viaHeader = await get('/api/content/articles', token, { 'shapio-schema-version': v });
    expect(viaHeader.statusCode).toBe(200);
    expect((await get(at('/api/content/articles'), token, { 'shapio-schema-version': v })).statusCode).toBe(
      200,
    );
  });

  it('sends the current version, varies on the header, and tags lens bodies apart', async () => {
    const lensed = await get(at('/api/content/articles'));
    const current = await get('/api/content/posts');
    const now = await currentToken();
    expect(lensed.headers['shapio-schema-version-current']).toBe(now);
    expect(current.headers['shapio-schema-version-current']).toBe(now);
    expect(String(current.headers.vary)).toContain('Shapio-Schema-Version');
    expect(lensed.headers.etag).not.toBe(current.headers.etag);
    // Naming today's version reads today's shape, with the versions in meta.
    const named = await json<DeliveredList>(`/api/content/posts?schemaVersion=${encodeURIComponent(now)}`);
    expect(named.data[0]).toHaveProperty('headline');
    expect(named.meta.schemaVersion).toEqual({ requested: now, current: now });
  });

  it('renders the old contract and exports the version token', async () => {
    const old = await json<{ schemaVersion: number; source: string }>(at('/api/docs/typescript'), adminToken);
    expect(old.source).toContain(`export const SCHEMA_VERSION = '${v}' as const;`);
    expect(old.source).toMatch(/\btitle\??:/);
    expect(old.source).not.toMatch(/\bheadline\??:/);
    const today = await json<{ source: string }>('/api/docs/typescript', adminToken);
    expect(today.source).toContain(`export const SCHEMA_VERSION = '${await currentToken()}' as const;`);
    expect(today.source).toMatch(/\bheadline\??:/);
    const openApi = await json<{ paths: Record<string, unknown> }>(at('/api/docs/openapi.json'), adminToken);
    expect(Object.keys(openApi.paths).some((path) => path.includes('/articles'))).toBe(true);
  });

  describe.skipIf(isSqliteRun())('in-process delivery', () => {
    let runtime: DeliveryRuntime;
    let local: RequestFn;

    beforeAll(async () => {
      await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
      runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
      local = createInProcessRequest(runtime, { token });
    });
    afterAll(async () => {
      await runtime?.close();
    });

    it('answers the old shape as HTTP does', async () => {
      for (const path of [
        at('/api/content/articles?sort=title:asc'),
        at(`/api/content/articles/${first.id}`),
        at('/api/snapshots/changes?from=0'),
      ]) {
        expect(await local(path)).toStrictEqual(expectStatus(await get(path), 200).json());
      }
    });
  });
});
