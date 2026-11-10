import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import {
  bearer,
  createAppRole,
  setAuthenticatedGrants,
  setPublicGrants,
  signUp,
  type AppSessionBody,
} from './helpers/appUsers.js';
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
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ErrorBody = { error: { code: string; message: string } };

/**
 * Schema lenses against callers that may not read or write (plan schema-lenses, adversarial review): a
 * request naming a schema version answers an unauthorized caller exactly as the same request without one, and
 * a write through a lens starts from what the write really starts from.
 */
describe('schema lenses and authorization', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let session: TestSession;
  let author: ModelBody;
  let seo: ModelBody;
  let article: ModelBody;
  let promo: ModelBody;
  let legacy: ModelBody;
  let readerToken: string;
  let ungrantedToken: string;
  let editor: AppSessionBody;
  let readEditor: AppSessionBody;
  let shared: EntryBody;
  let echoed: EntryBody;
  let guestPost: EntryBody;
  let v: string;

  const request = (
    method: string,
    url: string,
    credential: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    testApp.app.inject({
      method: method as InjectOptions['method'],
      url,
      headers: { ...(credential ? bearer(credential) : {}), ...headers },
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
  const at = (url: string) => `${url}${url.includes('?') ? '&' : '?'}schemaVersion=${encodeURIComponent(v)}`;
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({ ...rest, type, settings: {} });
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Record<string, unknown>,
    kind: 'models' | 'components' = 'models',
  ) => {
    const current = (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
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
    return (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
  };
  const adminEntry = async (id: string, locale = 'en') =>
    expectStatus(await admin.get(`/api/admin/content/article/${id}?locale=${locale}`), 200).json<EntryBody>();
  const createAndPublish = async (modelKey: string, data: Record<string, unknown>) => {
    const entry = expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${entry.id}/publish`, {}), 200);
    return entry;
  };
  const assignRoles = async (userId: string, roleIds: string[]) =>
    expectStatus(
      await admin.request({ method: 'PATCH', url: `/api/admin/app-users/${userId}`, payload: { roleIds } }),
      200,
    );
  /** Status and body of a request with the version named, and of the same request without it. */
  const both = async (method: string, url: string, credential: string | null, payload?: unknown) => {
    const lensed = await request(method, at(url), credential, payload);
    const plain = await request(method, url, credential, payload);
    return {
      lensed: [lensed.statusCode, lensed.json<unknown>()],
      plain: [plain.statusCode, plain.json<unknown>()],
    };
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    session = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['editor'] }));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      pluralApiKey: 'authors',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    seo = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'seo',
        label: 'SEO',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      'components',
    );
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        { apiKey: 'secret', label: 'Secret', type: 'string', public: false, filterable: true },
        { apiKey: 'gone', label: 'Gone', type: 'string', filterable: true },
        { apiKey: 'count', label: 'Count', type: 'integer' },
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'seo',
          label: 'SEO',
          type: 'component',
          localized: false,
          settings: { component: seo.definition.id },
        },
      ],
    });
    promo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'promo',
      label: 'Promo',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    legacy = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'legacy',
      pluralApiKey: 'legacies',
      label: 'Legacy',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    readerToken = await createTokenForRole(
      database.current.db,
      await createRole(
        database.current.db,
        'delivery',
        [author, article, promo, legacy].map((model) => ({
          action: 'read' as const,
          modelId: model.definition.id,
        })),
      ),
    );
    ungrantedToken = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [{ action: 'read', modelId: author.definition.id }]),
    );
    await setPublicGrants(database.current.db, []);
    await setAuthenticatedGrants(database.current.db, []);
    editor = await signUp(testApp.app);
    readEditor = await signUp(testApp.app);
    await assignRoles(editor.user.id, [
      await createAppRole(database.current.db, [{ action: 'update', modelId: article.definition.id }]),
    ]);
    await assignRoles(readEditor.user.id, [
      await createAppRole(database.current.db, [
        { action: 'update', modelId: article.definition.id },
        { action: 'read', modelId: article.definition.id },
      ]),
    ]);

    const writer = await createAndPublish('author', { name: 'Ada' });
    shared = await createAndPublish('article', { title: 'Shared', seo: { title: 's' } });
    echoed = await createAndPublish('article', { title: 'Echo', count: 3, writer: writer.id });

    v = expectStatus(await request('GET', '/api/snapshots/current', readerToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;

    // Everything below happens after the client's version.
    seo = await change(
      seo,
      (definition) => ({
        ...definition,
        fields: [...definition.fields, { apiKey: 'canonicalUrl', label: 'Canonical URL', type: 'string' }],
      }),
      'components',
    );
    article = await change(article, (definition) => ({
      ...definition,
      fields: [
        field(definition, 'title'),
        field(definition, 'secret'),
        retype(field(definition, 'count'), 'string'),
        field(definition, 'writer'),
        field(definition, 'seo'),
      ],
    }));
    promo = await change(promo, (definition) => ({
      ...definition,
      kind: 'singleton',
      pluralApiKey: undefined,
    }));
    legacy = await change(legacy, (definition) => ({ ...definition, label: 'Legacy (renamed)' }));
    // History of `legacy` before that change is lost, as if pruned before 0.9.0.
    const { db } = database.current;
    const version = Number(v.split(':')[1]);
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', legacy.definition.id)
      .where('schema_version', '<=', version)
      .execute();
    await db
      .updateTable('schema_activations')
      .set({ backfilled: true })
      .where('model_id', '=', legacy.definition.id)
      .execute();
    clearLensCaches();
    // A kind of `author` the client's version does not know, written into a relation it does know.
    const guest = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'guest',
      pluralApiKey: 'guests',
      label: 'Guest',
      extends: author.definition.id,
      fields: [],
    });
    const guestAuthor = await createAndPublish('guest', { name: 'Gus' });
    guestPost = await createAndPublish('article', { title: 'Guest post', writer: guestAuthor.id });
    expect(guest.definition.id).toBeTruthy();
    // Today's editors fill what the client does not know, and change a draft after publishing.
    const sharedDraft = await adminEntry(shared.id);
    expectStatus(
      await admin.put(`/api/admin/content/article/${shared.id}`, {
        expectedVersion: sharedDraft.version,
        data: { seo: { title: 's', canonicalUrl: 'c' } },
      }),
      200,
    );
    const echoDraft = await adminEntry(echoed.id);
    expectStatus(
      await admin.put(`/api/admin/content/article/${echoed.id}`, {
        expectedVersion: echoDraft.version,
        data: { count: '7' },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('answers a caller that may not read exactly as without a version', async () => {
    const urls = [
      '/api/content/articles?filters[title][$eq]=x',
      '/api/content/articles?filters[secret][$eq]=x',
      '/api/content/articles?filters[gone][$eq]=x',
      '/api/content/articles?filters[nope][$eq]=x',
      '/api/content/articles?populate=writer.x',
      '/api/content/articles?populate=writer',
      '/api/content/articles?sort=gone',
      `/api/content/articles/${shared.id}?fields=gone`,
      '/api/content/promos',
      '/api/content/legacies',
      '/api/content/legacies?filters[nope][$eq]=1',
    ];
    for (const credential of [null, ungrantedToken]) {
      for (const url of urls) {
        const { lensed, plain } = await both('GET', url, credential);
        expect(lensed, `${credential ? 'ungranted' : 'anonymous'} ${url}`).toEqual(plain);
      }
    }
    // A caller that may read gets the lens's own answers, after authorization.
    const lens = async (url: string) => {
      const response = await request('GET', at(url), readerToken);
      return [response.statusCode, response.json<ErrorBody>().error?.code];
    };
    expect(await lens('/api/content/articles?filters[gone][$eq]=x')).toEqual([400, 'LENS_QUERY_UNSUPPORTED']);
    expect(await lens('/api/content/promos')).toEqual([409, 'LENS_UNCOVERED']);
    expect(await lens('/api/content/legacies')).toEqual([409, 'SCHEMA_VERSION_UNAVAILABLE']);
  });

  it('checks the preview token before anything lens-specific', async () => {
    for (const url of [
      '/api/preview/content/articles?filters[nope][$eq]=1',
      '/api/preview/content/promos',
      '/api/preview/content/legacies',
      '/api/preview/content/nothing',
    ]) {
      for (const credential of [null, 'not-a-preview-token']) {
        const { lensed, plain } = await both('GET', url, credential);
        expect(lensed, url).toEqual(plain);
      }
    }
    const { token: previewToken } = expectStatus(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/preview/tokens',
        headers: session.headers,
        payload: { modelKey: 'article', entryId: shared.id },
      }),
      201,
    ).json<{ token: string }>();
    const refused = await request(
      'GET',
      at('/api/preview/content/articles?filters[gone][$eq]=1'),
      previewToken,
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json<ErrorBody>().error.code).toBe('LENS_QUERY_UNSUPPORTED');
  });

  it('refuses a create the caller may not make before reading its body through the lens', async () => {
    const body = { data: { count: 4, gone: 'x', nope: 1 } };
    for (const credential of [null, ungrantedToken, readEditor.accessToken]) {
      const { lensed, plain } = await both('POST', '/api/content/articles', credential, body);
      expect(lensed).toEqual(plain);
      expect(lensed[0]).not.toBe(422);
    }
  });

  it('keeps what the client does not know when it writes a locale that has no draft yet, without read access', async () => {
    expectStatus(
      await request('PUT', at(`/api/content/articles/${shared.id}`), editor.accessToken, {
        locale: 'fr',
        expectedVersion: null,
        data: { seo: { title: 'x' } },
      }),
      200,
    );
    for (const locale of ['en', 'fr']) {
      expect((await adminEntry(shared.id, locale)).data.seo, locale).toEqual({
        title: 'x',
        canonicalUrl: 'c',
      });
    }
    // An update in a locale that has a draft, by a caller that may not read: the added value stays too.
    const fr = await adminEntry(shared.id, 'fr');
    expectStatus(
      await request('PUT', at(`/api/content/articles/${shared.id}`), editor.accessToken, {
        locale: 'fr',
        expectedVersion: fr.version,
        data: { seo: { title: 'y' } },
      }),
      200,
    );
    expect((await adminEntry(shared.id, 'en')).data.seo).toEqual({ title: 'y', canonicalUrl: 'c' });
  });

  it('accepts a value echoed from the published read when the draft differs, and keeps the draft', async () => {
    const read = expectStatus(
      await request('GET', at(`/api/content/articles/${echoed.id}`), readEditor.accessToken),
      200,
    ).json<{ data: Record<string, unknown> }>();
    expect(read.data.count).toBe(3);
    const draft = await adminEntry(echoed.id);
    // The draft holds count '7' (read as 7 through the version); a caller without draft access that guesses it
    // is refused exactly as for any other value: only heads it may read count as "sent back".
    const guess = await request('PUT', at(`/api/content/articles/${echoed.id}`), readEditor.accessToken, {
      expectedVersion: draft.version,
      data: { count: 7 },
    });
    expect(guess.statusCode).toBe(422);
    expect(guess.json<ErrorBody>().error.code).toBe('LENS_WRITE_UNSUPPORTED');
    expectStatus(
      await request('PUT', at(`/api/content/articles/${echoed.id}`), readEditor.accessToken, {
        expectedVersion: draft.version,
        data: { title: 'Echo 2', count: read.data.count },
      }),
      200,
    );
    expect((await adminEntry(echoed.id)).data).toMatchObject({ title: 'Echo 2', count: '7' });
  });

  it('leaves out relation targets of kinds the client does not know, populated or not', async () => {
    const plain = await request('GET', at(`/api/content/articles/${guestPost.id}`), readerToken);
    expect(plain.json<{ data: Record<string, unknown> }>().data.writer).toBeNull();
    const populated = await request(
      'GET',
      at(`/api/content/articles/${guestPost.id}?populate=writer`),
      readerToken,
    );
    expect(populated.json<{ data: Record<string, unknown> }>().data.writer).toBeNull();
    // Today's clients see it.
    const today = await request('GET', `/api/content/articles/${guestPost.id}`, readerToken);
    expect(today.json<{ data: Record<string, unknown> }>().data.writer).toBeTruthy();
  });

  it("never shows a zone item of a component today's zone no longer allows", async () => {
    const hero = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      'components',
    );
    const quote = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'quote',
        label: 'Quote',
        fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
      },
      'components',
    );
    let page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        {
          apiKey: 'blocks',
          label: 'Blocks',
          type: 'dynamiczone',
          settings: { components: [hero.definition.id, quote.definition.id] },
        },
      ],
    });
    const token = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [{ action: 'read', modelId: page.definition.id }]),
    );
    const entry = await createAndPublish('page', {
      blocks: [
        { __component: 'quote', text: 'quoted' },
        { __component: 'hero', title: 'shown' },
      ],
    });
    const before = expectStatus(await request('GET', '/api/snapshots/current', token), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // Narrowing the zone: Shapio re-validates stored items, so the change is refused while an item uses it.
    const current = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    const narrowed = await admin.put(`/api/admin/models/${page.definition.id}`, {
      definition: {
        ...current.definition,
        fields: [{ ...field(current.definition, 'blocks'), settings: { components: [hero.definition.id] } }],
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    await runContentSchemaJobs(database.current.db);
    page = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    const allowed = (field(page.definition, 'blocks').settings as { components: string[] }).components;
    const read = expectStatus(
      await request(
        'GET',
        `/api/content/pages/${entry.id}?schemaVersion=${encodeURIComponent(before)}`,
        token,
      ),
      200,
    ).json<{ data: { blocks: Array<Record<string, unknown>> } }>();
    if (allowed.includes(quote.definition.id)) {
      // Refused (or its job failed): the item stays allowed and readable.
      expect([200, 202, 409, 422]).toContain(narrowed.statusCode);
      expect(read.data.blocks).toHaveLength(2);
    } else {
      expect(JSON.stringify(read.data)).not.toContain('quoted');
    }
  });

  it('never wipes component fields the caller cannot read when it writes the component, with or without a version', async () => {
    const profile = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'profile',
        label: 'Profile',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          { apiKey: 'internal', label: 'Internal', type: 'string', public: false },
          { apiKey: 'legacyNote', label: 'Legacy note', type: 'string', deprecated: true },
        ],
      },
      'components',
    );
    const card = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'card',
      label: 'Card',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'profile',
          label: 'Profile',
          type: 'component',
          settings: { component: profile.definition.id },
        },
        {
          apiKey: 'blocks',
          label: 'Blocks',
          type: 'dynamiczone',
          settings: { components: [profile.definition.id] },
        },
      ],
    });
    const user = await signUp(testApp.app);
    await assignRoles(user.user.id, [
      await createAppRole(database.current.db, [
        { action: 'read', modelId: card.definition.id },
        { action: 'update', modelId: card.definition.id },
      ]),
    ]);
    const stored = { name: 'n', internal: 'secret' };
    const entry = expectStatus(
      await admin.post('/api/admin/content/card', { data: { title: 't', profile: stored } }),
      201,
    ).json<EntryBody>();
    const withZone = async () => {
      const current = expectStatus(
        await admin.get(`/api/admin/content/card/${entry.id}`),
        200,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/card/${entry.id}`, {
          expectedVersion: current.version,
          data: {
            profile: { name: 'n', internal: 'secret' },
            blocks: [{ __component: 'profile', name: 'b', internal: 'z' }],
          },
        }),
        200,
      );
    };
    await withZone();
    const cardV = expectStatus(await request('GET', '/api/snapshots/current', readerToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    await change(card, (definition) => ({ ...definition, label: 'Card (renamed)' }));
    const versionOf = async () =>
      expectStatus(await admin.get(`/api/admin/content/card/${entry.id}`), 200).json<EntryBody>().version;
    for (const suffix of ['', `?schemaVersion=${encodeURIComponent(cardV)}`]) {
      expectStatus(
        await request('PUT', `/api/content/cards/${entry.id}${suffix}`, user.accessToken, {
          expectedVersion: await versionOf(),
          data: {
            profile: { name: `edited${suffix.length}` },
            blocks: [{ __component: 'profile', name: 'b2' }],
          },
        }),
        200,
      );
      const after = expectStatus(
        await admin.get(`/api/admin/content/card/${entry.id}`),
        200,
      ).json<EntryBody>();
      expect(after.data.profile, suffix).toMatchObject({
        name: `edited${suffix.length}`,
        internal: 'secret',
      });
      expect(after.data.blocks, suffix).toEqual([{ __component: 'profile', name: 'b2', internal: 'z' }]);
    }
  });

  it('hides a deprecated component field through a lens exactly as without one', async () => {
    const box = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'box',
        label: 'Box',
        fields: [
          { apiKey: 'shown', label: 'Shown', type: 'string' },
          { apiKey: 'retired', label: 'Retired', type: 'string' },
        ],
      },
      'components',
    );
    const crate = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'crate',
      label: 'Crate',
      fields: [
        { apiKey: 'box', label: 'Box', type: 'component', settings: { component: box.definition.id } },
      ],
    });
    const token = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [{ action: 'read', modelId: crate.definition.id }]),
    );
    const entry = await createAndPublish('crate', { box: { shown: 's', retired: 'hidden value' } });
    const crateV = expectStatus(await request('GET', '/api/snapshots/current', token), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    await change(
      box,
      (definition) => ({
        ...definition,
        fields: [field(definition, 'shown'), { ...field(definition, 'retired'), deprecated: true }],
      }),
      'components',
    );
    await change(crate, (definition) => ({ ...definition, label: 'Crate (renamed)' }));
    const plain = await request('GET', `/api/content/crates/${entry.id}`, token);
    const lensed = await request(
      'GET',
      `/api/content/crates/${entry.id}?schemaVersion=${encodeURIComponent(crateV)}`,
      token,
    );
    expect(JSON.stringify(plain.json())).not.toContain('hidden value');
    expect(JSON.stringify(lensed.json())).not.toContain('hidden value');
  });

  it('varies every answer of a lensed route on the version header, errors included', async () => {
    for (const url of [
      '/api/content/articles?schemaVersion=7',
      at('/api/content/promos'),
      at('/api/content/nothing'),
    ]) {
      const response = await request('GET', url, readerToken);
      expect(response.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(String(response.headers.vary), url).toContain('Shapio-Schema-Version');
    }
  });

  it('records the schema version for API tokens only, never for the anonymous or app-user aggregates', async () => {
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: article.definition.id }]);
    try {
      expectStatus(await request('GET', at('/api/content/articles'), null), 200);
      expectStatus(await request('GET', at('/api/content/articles'), readEditor.accessToken), 200);
      expectStatus(await request('GET', at('/api/content/articles'), readerToken), 200);
      await testApp.app.usage.flush();
      const rows = await database.current.db
        .selectFrom('token_reads')
        .select(['principal_key', 'last_schema_version'])
        .execute();
      const byKey = new Map(rows.map((row) => [row.principal_key, row.last_schema_version]));
      expect(byKey.get('anonymous') ?? null).toBeNull();
      expect(byKey.get('app_users') ?? null).toBeNull();
      expect(
        [...byKey].some(([key, version]) => key.startsWith('token:') && version === Number(v.split(':')[1])),
      ).toBe(true);
    } finally {
      await setPublicGrants(database.current.db, []);
    }
  });
});
