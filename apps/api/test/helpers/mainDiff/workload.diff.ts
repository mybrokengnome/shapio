import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createDb } from '../../../src/db/index.js';
import { migrateToLatest } from '../../../src/db/migrator.js';
import { bearer, createAppRole, loginAppUser, setPublicGrants, signUp } from '../appUsers.js';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type GrantSpec,
  type ModelBody,
} from '../content.js';
import { createTestApp, type TestApp } from '../createTestApp.js';
import { createRoleToken, schemaClient } from '../schemaAdmin.js';
import { silentLogger } from '../silentLogger.js';

/**
 * The differential's workload (run by `run.sh` with its own vitest config; not part of the test projects): in 0.8.2 terms only (no schema version named, no
 * item IDs sent). Phase `seed` (on main) makes the schema, callers and content; phase `replay` (on main, and on the
 * branch over a copy of the same database, upgraded by the branch's migrations) runs one deterministic workload of
 * reads and writes from every caller kind and records every observable after each step.
 */

const PHASE = process.env.MAIN_DIFF_PHASE as 'seed' | 'replay';
const URL = process.env.MAIN_DIFF_DB as string;
const MANIFEST = process.env.MAIN_DIFF_MANIFEST as string;
const OUT = process.env.MAIN_DIFF_OUT as string;
const SEED = Number(process.env.MAIN_DIFF_SEED ?? 1);
const STEPS = Number(process.env.MAIN_DIFF_STEPS ?? 120);

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const prng = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p: number) => next() < p,
  };
};

type Manifest = {
  adminToken: string;
  users: Record<'reader' | 'updateOnly' | 'owner', string>;
  entries: Array<{
    id: string;
    model: 'doc' | 'ndoc' | 'ldoc' | 'cmove' | 'dref' | 'drefn';
    ahead?: string;
    owned?: boolean;
  }>;
  things: { published: string; unpublished: string };
  /** Field ID → API ID, so stored data compares by field name (diff.mjs keeps comparing untouched fields). */
  fieldKeys: Record<string, string>;
  /** Relation targets that are no longer live entries (review 15). */
  deadTargets: string[];
};

const open = async () => {
  const db = createDb({ connectionString: URL, poolMax: 4 });
  await migrateToLatest(db, silentLogger);
  const testApp = await createTestApp(
    { name: 'main-diff', url: URL, db, drop: async () => db.destroy() },
    { schemaListen: false, env: { GRAPHQL_ENABLED: 'true', RATE_LIMIT_MAX: '1000000' } },
  );
  return { db, testApp };
};

// ---------------------------------------------------------------------------------------------------------
// Seed (main)

const seed = async (testApp: TestApp, db: ReturnType<typeof createDb>): Promise<Manifest> => {
  const adminToken = await createRoleToken(db);
  const admin = schemaClient(testApp.app, adminToken);
  expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
  const thing = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'thing',
    label: 'Thing',
    fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
  });
  const component = (apiKey: string, fields: unknown[]) =>
    createDefinition(admin, { kind: 'component', apiKey, label: apiKey, fields }, 'components');
  const chip = await component('chip', [{ apiKey: 'zv', label: 'Zv', type: 'string' }]);
  const card = await component('card', [
    { apiKey: 'heading', label: 'Heading', type: 'string' },
    { apiKey: 'note', label: 'Note', type: 'string', public: false },
    {
      apiKey: 'rel',
      label: 'Rel',
      type: 'relation',
      settings: { target: thing.definition.id, cardinality: 'one' },
    },
    {
      apiKey: 'rels',
      label: 'Rels',
      type: 'relation',
      settings: { target: thing.definition.id, cardinality: 'many' },
    },
    {
      apiKey: 'chips',
      label: 'Chips',
      type: 'component',
      settings: { component: chip.definition.id, repeatable: true },
    },
  ]);
  const box = await component('box', [
    { apiKey: 'label', label: 'Label', type: 'string' },
    {
      apiKey: 'items',
      label: 'Items',
      type: 'component',
      settings: { component: chip.definition.id, repeatable: true },
    },
  ]);
  const fields = [
    { apiKey: 'title', label: 'Title', type: 'string', localized: true },
    {
      apiKey: 'cards',
      label: 'Cards',
      type: 'component',
      settings: { component: card.definition.id, repeatable: true },
    },
    {
      apiKey: 'lchips',
      label: 'Lchips',
      type: 'component',
      localized: true,
      settings: { component: chip.definition.id, repeatable: true },
    },
    { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: box.definition.id } },
    {
      apiKey: 'zone',
      label: 'Zone',
      type: 'dynamiczone',
      settings: { components: [card.definition.id, chip.definition.id] },
    },
    {
      apiKey: 'ref',
      label: 'Ref',
      type: 'relation',
      settings: { target: thing.definition.id, cardinality: 'one' },
    },
  ];
  const doc = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'doc',
    label: 'Doc',
    localized: true,
    fields,
  });
  const ndoc = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'ndoc',
    label: 'Ndoc',
    localized: true,
    draftAndPublish: false,
    fields,
  });
  const thingOf = async (name: string, publish: boolean) => {
    const id = expectStatus(await admin.post('/api/admin/content/thing', { data: { name } }), 201).json<{
      id: string;
    }>().id;
    if (publish) {
      expectStatus(await admin.post(`/api/admin/content/thing/${id}/publish`, {}), 200);
    }
    return id;
  };
  const things = { published: await thingOf('p', true), unpublished: await thingOf('d', false) };
  // Review 10: a localized model whose localized list's component has a private sub-field, beside a shared list.
  expectStatus(await admin.post('/api/admin/locales', { code: 'de', label: 'German' }), 201);
  const litem = await component('litem', [
    { apiKey: 'label', label: 'Label', type: 'string' },
    { apiKey: 'secret', label: 'Secret', type: 'string', public: false },
  ]);
  const ldoc = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'ldoc',
    label: 'Ldoc',
    localized: true,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string', localized: true },
      {
        apiKey: 'litems',
        label: 'Litems',
        type: 'component',
        localized: true,
        settings: { component: litem.definition.id, repeatable: true },
      },
      {
        apiKey: 'sitems',
        label: 'Sitems',
        type: 'component',
        settings: { component: chip.definition.id, repeatable: true },
      },
    ],
  });
  // Review 13: copies and moves of items between entries and fields: `h1`/`h2` hold `chip` (nothing hidden),
  // `p1`/`p2` hold `litem` (a private `secret`).
  const cmove = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'cmove',
    label: 'Cmove',
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string' },
      ...['h1', 'h2'].map((apiKey) => ({
        apiKey,
        label: apiKey,
        type: 'component',
        settings: { component: chip.definition.id, repeatable: true },
      })),
      ...['p1', 'p2'].map((apiKey) => ({
        apiKey,
        label: apiKey,
        type: 'component',
        settings: { component: litem.definition.id, repeatable: true },
      })),
    ],
  });
  // Review 15: relations to targets that die (their only locale deleted, or deleted raw), on a type with drafts
  // (`dref`) and one without (`drefn`); `dcard` holds a private `secret` beside the relation.
  const dcard = await component('dcard', [
    { apiKey: 'label', label: 'Label', type: 'string' },
    { apiKey: 'secret', label: 'Secret', type: 'string', public: false },
    { apiKey: 'rels', label: 'Rels', type: 'relation', settings: { target: '*', cardinality: 'many' } },
  ]);
  const drefModel = (apiKey: string, draftAndPublish: boolean) =>
    createDefinition(admin, {
      kind: 'collection',
      apiKey,
      label: apiKey,
      draftAndPublish,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'items',
          label: 'Items',
          type: 'component',
          settings: { component: dcard.definition.id, repeatable: true },
        },
      ],
    });
  const dref = await drefModel('dref', true);
  const drefn = await drefModel('drefn', false);
  const models: ModelBody[] = [doc, ndoc, ldoc, cmove, dref, drefn];
  const grants = (actions: GrantSpec['action'][], extra: Partial<GrantSpec> = {}): GrantSpec[] =>
    models.flatMap((model) => actions.map((action) => ({ action, modelId: model.definition.id, ...extra })));
  const user = async (name: string, list: GrantSpec[]) => {
    const email = `${name}-${SEED}@example.com`;
    const session = await signUp(testApp.app, { email });
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${session.user.id}`,
        payload: { roleIds: [await createAppRole(db, list)] },
      }),
      200,
    );
    return { email, session };
  };
  const readThings: GrantSpec = { action: 'read', modelId: thing.definition.id };
  const reader = await user('reader', [...grants(['read', 'create', 'update']), readThings]);
  const updateOnly = await user('updateonly', grants(['create', 'update']));
  const owner = await user('owner', [
    ...grants(['read', 'update'], { condition: 'ownedByPrincipal' }),
    ...grants(['create']),
    readThings,
  ]);
  await setPublicGrants(db, grants(['read']));
  // Content: look-alikes, private notes, relations to a published and an unpublished thing, nested lists.
  const random = prng(SEED);
  const entries: Manifest['entries'] = [];
  for (let index = 0; index < 12; index += 1) {
    const model = index % 3 === 2 ? 'ndoc' : 'doc';
    const data = {
      title: `t${index}`,
      cards: Array.from({ length: 1 + random.int(3) }, (_, at) => ({
        heading: random.pick(['A', 'B', 'S']),
        ...(random.chance(0.6) ? { note: `n${index}-${at}` } : {}),
        ...(random.chance(0.4) ? { rel: random.pick([things.published, things.unpublished]) } : {}),
        ...(random.chance(0.4) ? { rels: [things.published, things.unpublished] } : {}),
        chips: Array.from({ length: random.int(3) }, () => ({ zv: random.pick(['a', 'b']) })),
      })),
      lchips: [{ zv: 'l' }],
      hero: { label: 'L', items: [{ zv: 'i' }] },
      zone: [{ __component: 'chip', zv: 'z' }],
      ...(random.chance(0.5) ? { ref: things.published } : {}),
    };
    const id = expectStatus(
      await admin.post(`/api/admin/content/${model}?locale=en`, { locale: 'en', data }),
      201,
    ).json<{ id: string }>().id;
    if (index % 4 === 1) {
      expectStatus(
        await admin.put(`/api/admin/content/${model}/${id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: `fr${index}`, lchips: [{ zv: 'f' }] },
        }),
        200,
      );
    }
    const state = index % 6;
    if (model === 'doc' && state !== 5) {
      expectStatus(
        await admin.post(`/api/admin/content/doc/${id}/publish`, {
          locales: index % 4 === 1 ? ['en', 'fr'] : ['en'],
        }),
        200,
      );
      if (state === 3) {
        const view = (await admin.get(`/api/admin/content/doc/${id}?locale=en`)).json<{ version: number }>();
        expectStatus(
          await admin.put(`/api/admin/content/doc/${id}?locale=en`, {
            locale: 'en',
            expectedVersion: view.version,
            data: { title: `t${index} draft` },
          }),
          200,
        );
      }
    }
    if (index % 5 === 0) {
      await db
        .updateTable('entries')
        .set({ owner_app_user_id: owner.session.user.id })
        .where('id', '=', id)
        .execute();
    }
    entries.push({ id, model, owned: index % 5 === 0 });
  }
  // Review 9: entries whose draft is ahead of the published head in one place (a list item, a nested list, a
  // single component, a zone), equal to it, never published, and in a second locale. Saved by main: legacy.
  const base = {
    title: 'a',
    cards: [
      { heading: 'A', note: 'n', chips: [{ zv: 'a' }] },
      { heading: 'B', chips: [] },
    ],
    lchips: [{ zv: 'l' }],
    hero: { label: 'L', items: [{ zv: 'i' }] },
    zone: [{ __component: 'chip', zv: 'z' }],
  };
  const aheadEdits: Record<string, (data: Json) => Json> = {
    item: (data) => ({
      cards: (data.cards as Json[]).map((card, at) => (at === 1 ? { ...card, heading: 'B2' } : card)),
    }),
    nested: (data) => ({
      cards: (data.cards as Json[]).map((card, at) =>
        at === 0 ? { ...card, chips: (card.chips as Json[]).map((chip) => ({ ...chip, zv: 'a2' })) } : card,
      ),
    }),
    single: (data) => ({ hero: { ...(data.hero as Json), label: 'L2' } }),
    zone: (data) => ({ zone: (data.zone as Json[]).map((item) => ({ ...item, zv: 'z2' })) }),
    twoLocales: (data) => ({ lchips: (data.lchips as Json[]).map((chip) => ({ ...chip, zv: 'f2' })) }),
  };
  for (const ahead of ['item', 'nested', 'single', 'zone', 'equal', 'never', 'twoLocales']) {
    const id = expectStatus(
      await admin.post('/api/admin/content/doc?locale=en', { locale: 'en', data: base }),
      201,
    ).json<{ id: string }>().id;
    const locale = ahead === 'twoLocales' ? 'fr' : 'en';
    if (ahead === 'twoLocales') {
      expectStatus(
        await admin.put(`/api/admin/content/doc/${id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr', lchips: [{ zv: 'f' }] },
        }),
        200,
      );
    }
    if (ahead !== 'never') {
      expectStatus(
        await admin.post(`/api/admin/content/doc/${id}/publish`, {
          locales: ahead === 'twoLocales' ? ['en', 'fr'] : ['en'],
        }),
        200,
      );
    }
    const edit = aheadEdits[ahead];
    if (edit) {
      const view = (await admin.get(`/api/admin/content/doc/${id}?locale=${locale}`)).json<{
        version: number;
        data: Json;
      }>();
      expectStatus(
        await admin.put(`/api/admin/content/doc/${id}?locale=${locale}`, {
          locale,
          expectedVersion: view.version,
          data: edit(view.data),
        }),
        200,
      );
    }
    entries.push({ id, model: 'doc', ahead });
  }
  // Review 10: ldoc entries in en and de, one fully published, one with de ahead of its published head.
  for (const ahead of ['published', 'deAhead', 'twins']) {
    const id = expectStatus(
      await admin.post('/api/admin/content/ldoc?locale=en', {
        locale: 'en',
        data: {
          title: 'en',
          litems: [
            { label: 'e1', secret: 's1' },
            { label: 'e2', secret: 's2' },
          ],
          // Review 11 (low): the `twins` entry's shared list holds two identical items.
          sitems: ahead === 'twins' ? [{ zv: 't' }, { zv: 't' }] : [{ zv: 's' }],
        },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(
      await admin.put(`/api/admin/content/ldoc/${id}?locale=de`, {
        locale: 'de',
        expectedVersion: null,
        data: { title: 'de', litems: [{ label: 'd1', secret: 'ds1' }] },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/ldoc/${id}/publish`, { locales: ['en', 'de'] }), 200);
    if (ahead === 'deAhead') {
      const view = (await admin.get(`/api/admin/content/ldoc/${id}?locale=de`)).json<{ version: number }>();
      expectStatus(
        await admin.put(`/api/admin/content/ldoc/${id}?locale=de`, {
          locale: 'de',
          expectedVersion: view.version,
          data: {
            litems: [
              { label: 'd1', secret: 'ds1' },
              { label: 'd2', secret: 'ds2' },
            ],
          },
        }),
        200,
      );
    }
    entries.push({ id, model: 'ldoc', ahead });
  }
  for (const name of ['a', 'b']) {
    const id = expectStatus(
      await admin.post('/api/admin/content/cmove', {
        data: {
          title: name,
          h1: [{ zv: `${name}h1x` }, { zv: `${name}h1y` }],
          h2: [{ zv: `${name}h2x` }],
          p1: [
            { label: `${name}p1x`, secret: `${name}s1` },
            { label: `${name}p1y`, secret: `${name}s2` },
          ],
          p2: [{ label: `${name}p2x`, secret: `${name}s3` }],
        },
      }),
      201,
    ).json<{ id: string }>().id;
    expectStatus(await admin.post(`/api/admin/content/cmove/${id}/publish`, {}), 200);
    entries.push({ id, model: 'cmove' });
  }
  // The targets: a doc entry that exists only in locale `xx` (deleted below), a thing deleted raw (below), and the
  // unpublished thing (alive, hidden from app users) as the twin.
  expectStatus(await admin.post('/api/admin/locales', { code: 'xx', label: 'Doomed' }), 201);
  const localeOnly = expectStatus(
    await admin.post('/api/admin/content/doc?locale=xx', { locale: 'xx', data: { title: 'only xx' } }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(await admin.post(`/api/admin/content/doc/${localeOnly}/publish`, { locales: ['xx'] }), 200);
  const rawDead = await thingOf('dead', true);
  for (const model of ['dref', 'drefn'] as const) {
    for (const [ahead, target] of [
      ['localeDead', localeOnly],
      ['rawDead', rawDead],
      ['unpublished', things.unpublished],
    ] as const) {
      const id = expectStatus(
        await admin.post(`/api/admin/content/${model}`, {
          data: {
            title: ahead,
            items: [
              { label: 'A', secret: 's', rels: [target] },
              { label: 'B', secret: 't' },
            ],
          },
        }),
        201,
      ).json<{ id: string }>().id;
      if (model === 'dref') {
        expectStatus(await admin.post(`/api/admin/content/dref/${id}/publish`, {}), 200);
      }
      entries.push({ id, model, ahead });
    }
  }
  expectStatus(await admin.delete('/api/admin/locales/xx?acknowledgeDestructive=true'), 200);
  await runContentSchemaJobs(db);
  await db
    .updateTable('entries')
    .set({ deleted_at: new Date().toISOString() })
    .where('id', '=', rawDead)
    .execute();
  const fieldKeys = Object.fromEntries(
    [chip, card, box, doc, ndoc, litem, ldoc, cmove, dcard, dref, drefn].flatMap((model) =>
      model.definition.fields.map((field) => [field.id, field.apiKey]),
    ),
  );
  return {
    adminToken,
    users: { reader: reader.email, updateOnly: updateOnly.email, owner: owner.email },
    entries,
    things,
    fieldKeys,
    deadTargets: [localeOnly, rawDead],
  };
};

// ---------------------------------------------------------------------------------------------------------
// Replay (main, then the branch on an upgraded copy)

const META = new Set(['createdAt', 'updatedAt', 'publishedAt', 'revisionId', 'autosavedAt']);

/** A response or stored value with what may differ between the sides by design left out: item IDs, times. */
const normal = (value: unknown, created: Map<string, string>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normal(item, created));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            key !== '__id' &&
            key !== 'itemIds' &&
            !(
              key === 'id' &&
              ('__component' in value ||
                (Object.keys(value).length > 1 &&
                  !('model' in value) &&
                  !('__model' in value) &&
                  !('locale' in value)))
            ),
        )
        .map(([key, entry]) => [
          key,
          META.has(key)
            ? 'T'
            : // The admin view's per-locale list has no defined order (PostgreSQL returns it either way, on both
              // sides): compared sorted by locale.
              key === 'locales' && Array.isArray(entry)
              ? normal(
                  [...(entry as Json[])].sort((x, y) => String(x.locale).localeCompare(String(y.locale))),
                  created,
                )
              : normal(entry, created),
        ]),
    );
  }
  if (typeof value !== 'string') {
    return value;
  }
  let text = value;
  for (const [id, name] of created) {
    text = text.split(id).join(name);
  }
  return text;
};

/** Stored data keyed by API ID instead of field ID (same fields on both sides: one database, copied). */
const byApiId = (value: unknown, keys: Record<string, string>): unknown =>
  Array.isArray(value)
    ? value.map((item) => byApiId(item, keys))
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [keys[key] ?? key, byApiId(entry, keys)]),
        )
      : value;

/** A value without item `id`s (what the caller can compare, ids aside). */
const withoutIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutIds)
    : isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, entry]) => [key, withoutIds(entry)]),
        )
      : value;

/**
 * Whether a body sends back what the caller read, ids aside: every list it sends holds the read's items, each
 * equal to exactly one read item and each read item sent once; every other field equals what was read.
 */
const contentMatchOf = (read: Json, body: Json): boolean =>
  Object.entries(body).every(([field, sent]) => {
    const stored = read[field];
    if (Array.isArray(sent) && Array.isArray(stored)) {
      const a = sent.map((item) => JSON.stringify(withoutIds(item)));
      const b = stored.map((item) => JSON.stringify(withoutIds(item)));
      return (
        a.length === b.length &&
        a.every((item) => b.filter((other) => other === item).length === 1) &&
        b.every((item) => a.filter((other) => other === item).length === 1)
      );
    }
    return JSON.stringify(withoutIds(sent)) === JSON.stringify(withoutIds(stored));
  });

const replay = async (testApp: TestApp, db: ReturnType<typeof createDb>, manifest: Manifest) => {
  const request = async (
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    token: string | null,
    payload?: unknown,
  ) => {
    const response = await testApp.app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as Json }),
    });
    let body: unknown = response.body;
    try {
      body = JSON.parse(response.body) as unknown;
    } catch {
      // not JSON
    }
    return { status: response.statusCode, body };
  };
  const outcomeOf = (response: { status: number; body: unknown }) => ({
    status: response.status,
    code: isRecord(response.body) && isRecord(response.body.error) ? response.body.error.code : null,
    issues:
      isRecord(response.body) &&
      isRecord(response.body.error) &&
      isRecord(response.body.error.details) &&
      Array.isArray(response.body.error.details.issues)
        ? (response.body.error.details.issues as Json[])
            .map((issue) => `${String(issue.code)} ${String(issue.path)}`)
            .sort()
        : [],
    body: normal(response.body, created),
  });
  const login = async (email: string) =>
    (await loginAppUser(testApp.app, email)).json<{ accessToken: string }>().accessToken;
  const tokens = {
    admin: manifest.adminToken,
    adminToken: manifest.adminToken,
    reader: await login(manifest.users.reader),
    updateOnly: await login(manifest.users.updateOnly),
    owner: await login(manifest.users.owner),
    anon: null,
  };
  const callers = ['admin', 'adminToken', 'reader', 'updateOnly', 'owner', 'anon'] as const;
  const created = new Map<string, string>();
  const entries = [...manifest.entries];
  const observeEntry = async (id: string, model: string) => {
    const heads = await db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data', 'version'])
      .where('entry_id', '=', id)
      .execute();
    const revisions = await db
      .selectFrom('content_revisions')
      .select('id')
      .where('entry_id', '=', id)
      .execute();
    const events = await db
      .selectFrom('outbox_events')
      .select('type')
      .where('aggregate_id', '=', id)
      .execute();
    const audit = await db.selectFrom('audit_events').select('action').execute();
    const view = await request('GET', `/api/admin/content/${model}/${id}?locale=en`, manifest.adminToken);
    return {
      heads: heads
        .map((head) => ({
          locale: head.locale,
          state: head.state,
          version: Number(head.version),
          data: normal(
            byApiId(typeof head.data === 'string' ? JSON.parse(head.data) : head.data, manifest.fieldKeys),
            created,
          ),
        }))
        .sort((a, b) => `${a.locale}${a.state}`.localeCompare(`${b.locale}${b.state}`)),
      revisions: revisions.length,
      events: events.map((event) => event.type).sort(),
      audit: audit.length,
      status: isRecord(view.body) ? view.body.status : null,
    };
  };
  /** What a step's own write starts from: the entry as stored just before it (counts, heads, audit rows). */
  const baselineOf = async (id: string, model: string) => {
    const observed = await observeEntry(id, model);
    return {
      revisions: observed.revisions,
      events: observed.events,
      heads: observed.heads,
      audit: observed.audit,
    };
  };
  const steps: Json[] = [];
  const random = prng(SEED * 7919);
  const ahead = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.ahead && (entry.model === 'doc' || entry.model === 'ndoc'));
  const ldocs = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.model === 'ldoc' && entry.ahead !== 'twins');
  const twins = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.ahead === 'twins');
  /**
   * What the docs' conditions need, worked out from the stored data and the caller (never from the response):
   * whether the caller sees the draft it writes (it may read the entry, and the draft is not ahead of the
   * published head it reads), the fields whose items can hold values hidden from it, and the stored values hidden
   * from it (private sub-fields; relation targets it cannot read). An admin-kind caller sees everything.
   */
  const preOf = async (
    caller: (typeof callers)[number],
    target: (typeof entries)[number],
    locale: string,
    body: unknown,
  ) => {
    // Top-level fields where the body sends a list item (at any depth) without an `id`.
    const missing = (entry: unknown): boolean =>
      Array.isArray(entry)
        ? entry.some((item) => (isRecord(item) && !('id' in item)) || missing(item))
        : isRecord(entry) && Object.values(entry).some(missing);
    const withoutIds = isRecord(body)
      ? Object.entries(body)
          .filter(([, value]) => missing(value))
          .map(([key]) => key)
      : [];
    const notTheirs = caller === 'owner' && target.owned !== true;
    if (caller === 'admin' || caller === 'adminToken') {
      return {
        seesDraft: true,
        notTheirs,
        withoutIds,
        hiddenFields: [],
        hiddenLeaves: [],
        hiddenTargets: [],
        deadTargets: manifest.deadTargets ?? [],
      };
    }
    // Every caller may read published entries: the seed's public read grants apply to anonymous and every signed-in
    // user (the owner's own-entries condition only narrows its role's extra grants).
    const reads = true;
    // The server's notion (contentDeliveryWrites `seesDraft`, contentReads `statusOf`): the caller sees the draft it
    // writes when that locale's draft is the published revision (same revision, not autosaved). A locale with no
    // draft yet, or a never-published one, is not seen.
    const heads = await db
      .selectFrom('entry_heads')
      .selectAll()
      .where('entry_id', '=', target.id)
      .where('locale', '=', locale)
      .execute();
    const draft = heads.find((row) => row.state === 'draft');
    const published = heads.find((row) => row.state === 'published');
    const ahead =
      !draft ||
      !published ||
      draft.revision_id !== published.revision_id ||
      ((draft as { autosaved_at?: unknown }).autosaved_at ?? null) !== null;
    return {
      seesDraft: reads && !ahead,
      notTheirs,
      withoutIds,
      hiddenFields: ['cards', 'zone', 'litems', 'p1', 'p2', 'items'],
      hiddenLeaves: ['note', 'secret'],
      deadTargets: manifest.deadTargets ?? [],
      // Callers without a read grant on things (update-only, anonymous) cannot read any relation target.
      hiddenTargets:
        caller === 'updateOnly' || caller === 'anon'
          ? [manifest.things.published, manifest.things.unpublished]
          : [manifest.things.unpublished],
    };
  };
  /**
   * Review 10: copies between locales. Read `en` and `de`; write `de` with its own items plus `en`'s, or `en` with
   * `de`'s (on the branch with the reads' `id`s, on main with none).
   */
  /**
   * Review 11: a stale retry. Caller A reads; caller B changes a list of the same entry (an admin API save without
   * ids, an item deleted, another client's save without ids, or an admin API edit with ids), maybe publishing;
   * A writes its old body (409 expected), then retries it with the version the 409 named.
   */
  const staleStep = async (step: number, caller: (typeof callers)[number], token: string | null) => {
    const index = random.int(entries.length);
    const target = entries[index] as (typeof entries)[number];
    const lists =
      target.model === 'ldoc'
        ? (['litems', 'sitems'] as const)
        : (['cards', 'lchips', 'chips', 'heroItems'] as const);
    const list = random.pick(lists);
    const way = random.pick(['adminNoIds', 'deleteItem', 'otherClientNoIds', 'editWithIds'] as const);
    const publish = target.model !== 'ndoc' && random.chance(0.5);
    const locale = random.chance(0.3) ? (target.model === 'ldoc' ? 'de' : 'fr') : 'en';
    const label = `${step} ${caller} stale e${index} ${target.model} ${locale} ${list} ${way}${publish ? ' publish' : ''}`;
    const plural = `${target.model}s`;
    const adminUrl = `/api/admin/content/${target.model}/${target.id}?locale=${locale}`;
    const adminView = async () => {
      const view = await request('GET', adminUrl, manifest.adminToken);
      return isRecord(view.body) ? view.body : {};
    };
    const seen = (await adminView()).version ?? null;
    const read =
      caller === 'admin'
        ? await request('GET', adminUrl, token)
        : await request('GET', `/api/content/${plural}/${target.id}?locale=${locale}`, token);
    const data = isRecord(read.body) && isRecord(read.body.data) ? read.body.data : {};
    const fields =
      target.model === 'ldoc' ? ['title', 'litems', 'sitems'] : ['title', 'cards', 'lchips', 'hero', 'zone'];
    const body: Json = {
      ...Object.fromEntries(Object.entries(data).filter(([key]) => fields.includes(key))),
      title: `${typeof data.title === 'string' ? data.title : 't'}!`,
    };
    // B changes the list.
    const stripIds = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(stripIds)
        : isRecord(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== 'id')
                .map(([key, entry]) => [key, stripIds(entry)]),
            )
          : value;
    const asList = (value: unknown) => (Array.isArray(value) ? (value as Json[]) : []);
    const editFirst = (items: Json[]) =>
      items.map((item, at) => {
        if (at !== 0) return item;
        const field = 'heading' in item ? 'heading' : 'label' in item ? 'label' : 'zv';
        return { ...item, [field]: `${String(item[field])}*` };
      });
    const patch = (current: Json, change: (items: Json[]) => Json[]): Json =>
      list === 'chips'
        ? {
            cards: asList(current.cards).map((card, at) =>
              at === 0 ? { ...card, chips: change(asList(card.chips)) } : card,
            ),
          }
        : list === 'heroItems'
          ? {
              hero: {
                ...(isRecord(current.hero) ? current.hero : {}),
                items: change(asList(isRecord(current.hero) ? current.hero.items : [])),
              },
            }
          : { [list]: change(asList(current[list])) };
    const before = await adminView();
    const current = isRecord(before.data) ? before.data : {};
    const hiddenList = ['cards', 'litems'].includes(list);
    const change =
      way === 'adminNoIds'
        ? (stripIds(patch(current, editFirst)) as Json)
        : way === 'deleteItem'
          ? patch(current, (items) => items.slice(0, 1))
          : way === 'editWithIds'
            ? patch(current, editFirst)
            : list === 'chips'
              ? patch(current, (items) => stripIds(items.slice(0, 1)) as Json[])
              : (stripIds(patch(current, hiddenList ? (items) => items.slice(0, 1) : editFirst)) as Json);
    const changed =
      way === 'otherClientNoIds'
        ? await request('PUT', `/api/content/${plural}/${target.id}?locale=${locale}`, manifest.adminToken, {
            locale,
            expectedVersion: before.version ?? null,
            data: change,
          })
        : await request('PUT', adminUrl, manifest.adminToken, {
            locale,
            expectedVersion: before.version ?? null,
            data: change,
          });
    // Whether B's change moved the version on this side (an earlier allowed difference can make it a no-op).
    const otherMoved = (await adminView()).version !== before.version;
    if (publish) {
      await request('POST', `/api/admin/content/${target.model}/${target.id}/publish`, manifest.adminToken, {
        locales: [locale],
      });
    }
    // A's writes are measured from here: the other writer's change (and publish) can be a no-op on one side after an
    // earlier allowed difference, and that is compared through `otherMoved`, not through the step's counters.
    const prepared = await observeEntry(target.id, target.model);
    const baseline = {
      revisions: prepared.revisions,
      events: prepared.events,
      heads: prepared.heads,
      audit: prepared.audit,
    };
    const pre = await preOf(caller, target, locale, body);
    const write = (expectedVersion: unknown) =>
      caller === 'admin'
        ? request('PUT', adminUrl, token, { locale, expectedVersion, data: body })
        : request('PUT', `/api/content/${plural}/${target.id}?locale=${locale}`, token, {
            locale,
            expectedVersion,
            data: body,
          });
    const first = await write(seen);
    const named =
      isRecord(first.body) && isRecord(first.body.error) && isRecord(first.body.error.details)
        ? first.body.error.details.currentVersion
        : undefined;
    const retry = first.status === 409 ? await write(named ?? null) : first;
    return {
      label,
      pre,
      otherStatus: changed.status,
      otherMoved,
      baseline,
      firstStatus: first.status,
      sent: normal(body, created),
      ...outcomeOf(retry),
      entry: await observeEntry(target.id, target.model),
    };
  };
  /**
   * Review 11 (low): with ids sent, reordering a shared list that holds two identical items (the content order is
   * unchanged) changes nothing; on main, no change.
   */
  const twinsStep = async (step: number, caller: (typeof callers)[number], token: string | null) => {
    const { entry: target, index } = twins[0] as (typeof twins)[number];
    const adminUrl = `/api/admin/content/ldoc/${target.id}?locale=en`;
    const read =
      caller === 'admin'
        ? await request('GET', adminUrl, token)
        : await request('GET', `/api/content/ldocs/${target.id}?locale=en`, token);
    const data = isRecord(read.body) && isRecord(read.body.data) ? read.body.data : {};
    const body = { sitems: [...(Array.isArray(data.sitems) ? (data.sitems as Json[]) : [])].reverse() };
    const view = await request('GET', adminUrl, manifest.adminToken);
    const version = isRecord(view.body) ? (view.body.version ?? null) : null;
    const response =
      caller === 'admin'
        ? await request('PUT', adminUrl, token, { locale: 'en', expectedVersion: version, data: body })
        : await request('PUT', `/api/content/ldocs/${target.id}?locale=en`, token, {
            locale: 'en',
            expectedVersion: version,
            data: body,
          });
    return {
      label: `${step} ${caller} twins e${index} ldoc en`,
      pre: await preOf(caller, target, 'en', body),
      sent: normal(body, created),
      ...outcomeOf(response),
      entry: await observeEntry(target.id, 'ldoc'),
      deView: normal(
        (await request('GET', `/api/admin/content/ldoc/${target.id}?locale=de`, manifest.adminToken)).body,
        created,
      ),
    };
  };
  const drefs = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.model === 'dref' || entry.model === 'drefn');
  /**
   * Review 15: a caller echoes its read of an entry whose hidden relation target died (or, the twin, is
   * unpublished), with the second item's label edited: on the branch with the read's ids.
   */
  const deadRelStep = async (step: number, caller: (typeof callers)[number], token: string | null) => {
    const { entry: target, index } = random.pick(drefs);
    const plural = `${target.model}s`;
    const url =
      caller === 'admin'
        ? `/api/admin/content/${target.model}/${target.id}`
        : `/api/content/${plural}/${target.id}`;
    const read = await request('GET', url, token);
    const data = isRecord(read.body) && isRecord(read.body.data) ? read.body.data : {};
    const items = (Array.isArray(data.items) ? (data.items as Json[]) : []).map((item, at) =>
      at === 1 ? { ...item, label: `${String(item.label)}~` } : item,
    );
    const body: Json = { items };
    const view = await request('GET', `/api/admin/content/${target.model}/${target.id}`, manifest.adminToken);
    const version = isRecord(view.body) ? (view.body.version ?? null) : null;
    const pre = { ...(await preOf(caller, target, 'en', body)), contentMatch: contentMatchOf(data, body) };
    const baseline = await baselineOf(target.id, target.model);
    const response = await request('PUT', url, token, { expectedVersion: version, data: body });
    return {
      label: `${step} ${caller} deadrel e${index} ${target.model} en ${target.ahead ?? '-'}`,
      baseline,
      pre,
      sent: normal(body, created),
      ...outcomeOf(response),
      entry: await observeEntry(target.id, target.model),
    };
  };
  const cmoves = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.model === 'cmove');
  /**
   * Review 13: copy another entry's items into this one (replace, or append), copy one field's items into another
   * of the same entry (replace, or append), or move an item between fields: with the reads' `id`s on the branch, none
   * on main. `pre.unclaimed` names the lists where a stored item is left unclaimed (its `id` sent nowhere in the
   * body, and no item with its content sent in that list), worked out from what the caller read.
   */
  const copyMoveStep = async (step: number, caller: (typeof callers)[number], token: string | null) => {
    const [first, second] = random.chance(0.5) ? [cmoves[0], cmoves[1]] : [cmoves[1], cmoves[0]];
    const { entry: target, index } = first as (typeof cmoves)[number];
    const { entry: source, index: sourceIndex } = second as (typeof cmoves)[number];
    const variant = random.pick([
      'otherReplace',
      'otherAppend',
      'fieldReplace',
      'fieldAppend',
      'move',
    ] as const);
    const [x1, x2] = random.chance(0.5) ? (['h1', 'h2'] as const) : (['p1', 'p2'] as const);
    const readOf = async (id: string) => {
      const response =
        caller === 'admin'
          ? await request('GET', `/api/admin/content/cmove/${id}`, token)
          : await request('GET', `/api/content/cmoves/${id}`, token);
      return isRecord(response.body) && isRecord(response.body.data) ? response.body.data : {};
    };
    // Both entries are published first, so the caller sees the draft it writes (the case the rule is about).
    for (const id of [target.id, source.id]) {
      await request('POST', `/api/admin/content/cmove/${id}/publish`, manifest.adminToken, {});
    }
    const prepared = await observeEntry(target.id, 'cmove');
    // The source was published too: its counters move here, not in its next step (diff.mjs takes this observation).
    const sourcePrepared = { entry: sourceIndex, observed: await observeEntry(source.id, 'cmove') };
    const baseline = {
      revisions: prepared.revisions,
      events: prepared.events,
      heads: prepared.heads,
      audit: prepared.audit,
    };
    const own = await readOf(target.id);
    const other = await readOf(source.id);
    const list = (data: Json, field: string) => (Array.isArray(data[field]) ? (data[field] as Json[]) : []);
    const body: Json =
      variant === 'otherReplace'
        ? { [x1]: list(other, x1) }
        : variant === 'otherAppend'
          ? { [x1]: [...list(own, x1), ...list(other, x1)] }
          : variant === 'fieldReplace'
            ? { [x2]: list(own, x1) }
            : variant === 'fieldAppend'
              ? { [x2]: [...list(own, x2), ...list(own, x1)] }
              : { [x1]: list(own, x1).slice(1), [x2]: [...list(own, x2), ...list(own, x1).slice(0, 1)] };
    const sentIds = new Set(
      Object.values(body).flatMap((items) =>
        (items as Json[]).map((item) => item.id).filter((id) => typeof id === 'string'),
      ),
    );
    // A stored item is claimed by its id sent anywhere in the body, or by content: its visible content appears
    // exactly once among the stored items and exactly once among the items sent to its list that the ids the draft
    // holds do not already resolve (an item sent with another stored item's id is that item, copied or moved).
    const contentOf = (item: Json) => JSON.stringify({ ...item, id: undefined });
    const unclaimed = Object.keys(body).filter((field) => {
      const stored = list(own, field);
      const held = new Set(
        ['h1', 'h2', 'p1', 'p2'].flatMap((name) => list(own, name).map((item) => String(item.id))),
      );
      const sent = (body[field] as Json[]).filter((item) => !held.has(String(item.id)));
      return stored.some(
        (item) =>
          !sentIds.has(String(item.id)) &&
          !(
            stored.filter((other) => contentOf(other) === contentOf(item)).length === 1 &&
            sent.filter((other) => contentOf(other) === contentOf(item)).length === 1
          ),
      );
    });
    const view = await request('GET', `/api/admin/content/cmove/${target.id}`, manifest.adminToken);
    const version = isRecord(view.body) ? (view.body.version ?? null) : null;
    // Every sent item equals exactly one stored item of its list in the caller's view, and each stored item is sent
    // once: the stored content, hidden values aside, is what is sent.
    const contentMatch = Object.keys(body).every((field) => {
      const stored = list(own, field).map(contentOf);
      const sent = (body[field] as Json[]).map(contentOf);
      return (
        stored.length === sent.length &&
        sent.every((item) => stored.filter((other) => other === item).length === 1) &&
        stored.every((item) => sent.filter((other) => other === item).length === 1)
      );
    });
    const pre = { ...(await preOf(caller, target, 'en', body)), unclaimed, contentMatch };
    const response =
      caller === 'admin'
        ? await request('PUT', `/api/admin/content/cmove/${target.id}`, token, {
            expectedVersion: version,
            data: body,
          })
        : await request('PUT', `/api/content/cmoves/${target.id}`, token, {
            expectedVersion: version,
            data: body,
          });
    return {
      label: `${step} ${caller} copymove e${index} cmove en ${variant} ${x1}`,
      baseline,
      alsoObserved: [sourcePrepared],
      // What the step copies: from which entry's field into which field of this entry (diff.mjs treats a copy of a
      // field that already differs between the sides as a consequence, for the field it lands in).
      copies:
        variant === 'otherReplace' || variant === 'otherAppend'
          ? [{ from: sourceIndex, field: x1, to: x1 }]
          : [{ from: index, field: x1, to: x2 }],
      pre,
      sent: normal(body, created),
      ...outcomeOf(response),
      entry: await observeEntry(target.id, 'cmove'),
    };
  };
  const locCopyStep = async (step: number, caller: (typeof callers)[number], token: string | null) => {
    const { entry: target, index } = random.pick(ldocs);
    const variant = random.pick(['toDe', 'toEn'] as const);
    const readLocale = async (locale: string) => {
      const response =
        caller === 'admin'
          ? await request('GET', `/api/admin/content/ldoc/${target.id}?locale=${locale}`, token)
          : await request('GET', `/api/content/ldocs/${target.id}?locale=${locale}`, token);
      return isRecord(response.body) && isRecord(response.body.data) ? response.body.data : {};
    };
    const en = await readLocale('en');
    const de = await readLocale('de');
    const items = (data: Json) => (Array.isArray(data.litems) ? (data.litems as Json[]) : []);
    const whole = (data: Json) =>
      Object.fromEntries(Object.entries(data).filter(([key]) => ['title', 'litems', 'sitems'].includes(key)));
    const locale = variant === 'toDe' ? 'de' : 'en';
    const body =
      variant === 'toDe'
        ? { ...whole(de), litems: [...items(de), ...items(en)] }
        : { ...whole(en), litems: items(de) };
    const adminView = await request(
      'GET',
      `/api/admin/content/ldoc/${target.id}?locale=${locale}`,
      manifest.adminToken,
    );
    const version =
      isRecord(adminView.body) && typeof adminView.body.version === 'number' ? adminView.body.version : null;
    const pre = await preOf(caller, target, locale, body);
    const response =
      caller === 'admin'
        ? await request('PUT', `/api/admin/content/ldoc/${target.id}?locale=${locale}`, token, {
            locale,
            expectedVersion: version,
            data: body,
          })
        : await request('PUT', `/api/content/ldocs/${target.id}?locale=${locale}`, token, {
            locale,
            expectedVersion: version,
            data: body,
          });
    return {
      label: `${step} ${caller} loccopy e${index} ldoc ${locale} ${target.ahead ?? '-'} ${variant}`,
      pre,
      sent: normal(body, created),
      ...outcomeOf(response),
      entry: await observeEntry(target.id, 'ldoc'),
    };
  };
  /**
   * Review 9: how old clients really save. Read (the caller's default view, or the draft view where it may read
   * drafts), change nothing or one scalar or one item field, and PUT the whole read back otherwise unmodified:
   * on the branch with whatever `id`s the read returned, on main with none.
   */
  const echoStep = async (
    step: number,
    caller: (typeof callers)[number],
    token: string | null,
    locale: string,
  ) => {
    const { entry: target, index } = random.chance(0.7)
      ? random.pick(ahead)
      : { entry: entries[random.int(entries.length)] as (typeof entries)[number], index: -1 };
    const entryIndex = index >= 0 ? index : entries.indexOf(target);
    const view = caller === 'adminToken' && random.chance(0.5) ? 'draft' : 'default';
    const edit = random.pick(['nothing', 'title', 'item', 'nested', 'single'] as const);
    const label = `${step} ${caller} echo e${entryIndex} ${target.model} ${locale} ${target.ahead ?? '-'} ${view} ${edit}`;
    const plural = `${target.model}s`;
    const read =
      caller === 'admin'
        ? await request('GET', `/api/admin/content/${target.model}/${target.id}?locale=${locale}`, token)
        : await request(
            'GET',
            `/api/content/${plural}/${target.id}?locale=${locale}${view === 'draft' ? '&publicationState=draft' : ''}`,
            token,
          );
    const data = isRecord(read.body) && isRecord(read.body.data) ? read.body.data : {};
    const whole = Object.fromEntries(
      Object.entries(data).filter(
        ([key]) =>
          ![
            'id',
            '__model',
            '__kinds',
            'locale',
            'createdAt',
            'updatedAt',
            'publishedAt',
            'model',
            'version',
            'status',
            'itemIds',
          ].includes(key),
      ),
    );
    const cards = Array.isArray(whole.cards) ? (whole.cards as Json[]) : [];
    const first = (list: unknown, change: (item: Json) => Json) =>
      Array.isArray(list) ? (list as Json[]).map((item, at) => (at === 0 ? change(item) : item)) : list;
    const body: Json =
      edit === 'title' && typeof whole.title === 'string'
        ? { ...whole, title: `${whole.title}~${step}` }
        : edit === 'item' && cards.length > 0
          ? { ...whole, cards: first(cards, (card) => ({ ...card, heading: `${String(card.heading)}~` })) }
          : edit === 'nested' && cards.length > 0
            ? {
                ...whole,
                cards: first(cards, (card) => ({
                  ...card,
                  chips: first(card.chips, (chip) => ({ ...chip, zv: `${String(chip.zv)}~` })),
                })),
              }
            : edit === 'single' && isRecord(whole.hero)
              ? { ...whole, hero: { ...whole.hero, label: `${String(whole.hero.label)}~` } }
              : whole;
    const adminView = await request(
      'GET',
      `/api/admin/content/${target.model}/${target.id}?locale=${locale}`,
      manifest.adminToken,
    );
    const version =
      isRecord(adminView.body) && typeof adminView.body.version === 'number' ? adminView.body.version : null;
    const pre = { ...(await preOf(caller, target, locale, body)), contentMatch: contentMatchOf(data, body) };
    const baseline = await baselineOf(target.id, target.model);
    const response =
      caller === 'admin'
        ? await request('PUT', `/api/admin/content/${target.model}/${target.id}?locale=${locale}`, token, {
            locale,
            expectedVersion: version,
            data: body,
          })
        : await request('PUT', `/api/content/${plural}/${target.id}?locale=${locale}`, token, {
            locale,
            expectedVersion: version,
            data: body,
          });
    return {
      label,
      readStatus: read.status,
      baseline,
      pre,
      sent: normal(body, created),
      ...outcomeOf(response),
      entry: await observeEntry(target.id, target.model),
    };
  };
  for (let step = 0; step < STEPS; step += 1) {
    const caller = random.pick(callers);
    const token = tokens[caller];
    const entryIndex = random.int(entries.length);
    const target = entries[entryIndex] as (typeof entries)[number];
    const plural = `${target.model}s`;
    const locale = random.chance(0.2) ? 'fr' : 'en';
    const op = random.pick([
      'read',
      'write',
      'write',
      'write',
      'create',
      'echo',
      'echo',
      'loccopy',
      'stale',
      'stale',
      'twins',
      'copymove',
      'deadrel',
    ] as const);
    if (op === 'deadrel') {
      steps.push(await deadRelStep(step, caller, token));
      continue;
    }
    if (op === 'copymove') {
      steps.push(await copyMoveStep(step, caller, token));
      continue;
    }
    if (op === 'stale') {
      steps.push(await staleStep(step, caller, token));
      continue;
    }
    if (op === 'twins') {
      steps.push(await twinsStep(step, caller, token));
      continue;
    }
    if (op === 'loccopy') {
      steps.push(await locCopyStep(step, caller, token));
      continue;
    }
    if (op === 'echo') {
      steps.push(await echoStep(step, caller, token, locale));
      continue;
    }
    const label = `${step} ${caller} ${op} e${entryIndex} ${target.model} ${locale}`;
    if (op === 'read') {
      const response =
        caller === 'admin'
          ? await request('GET', `/api/admin/content/${target.model}/${target.id}?locale=${locale}`, token)
          : await request('GET', `/api/content/${plural}/${target.id}?locale=${locale}`, token);
      steps.push({ label, status: response.status, body: normal(response.body, created) });
      continue;
    }
    // What the caller read (an app user that cannot read sends what it would write anyway).
    const read =
      caller === 'admin'
        ? (await request('GET', `/api/admin/content/${target.model}/${target.id}?locale=${locale}`, token))
            .body
        : (await request('GET', `/api/content/${plural}/${target.id}?locale=${locale}`, token)).body;
    const data = isRecord(read) && isRecord(read.data) ? read.data : {};
    const stripIds = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(stripIds)
        : isRecord(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== 'id')
                .map(([key, entry]) => [key, stripIds(entry)]),
            )
          : value;
    const echo = Object.fromEntries(
      Object.entries(stripIds(data) as Json).filter(
        ([key]) =>
          ![
            '__model',
            '__kinds',
            'locale',
            'createdAt',
            'updatedAt',
            'publishedAt',
            'model',
            'version',
            'status',
          ].includes(key),
      ),
    );
    const cards = Array.isArray(echo.cards) ? (echo.cards as Json[]) : [];
    const edit = random.pick([
      'echo',
      'title',
      'heading',
      'reorder',
      'delete',
      'append',
      'empty',
      'nothing',
      'cardsOnly',
    ] as const);
    const body: Json =
      edit === 'echo'
        ? echo
        : edit === 'title'
          ? { title: `${typeof echo.title === 'string' ? echo.title : 't'}~${step}` }
          : edit === 'heading'
            ? {
                cards: cards.map((card, index) =>
                  index === 0 ? { ...card, heading: `${String(card.heading)}~` } : card,
                ),
              }
            : edit === 'reorder'
              ? { cards: [...cards].reverse() }
              : edit === 'delete'
                ? { cards: cards.slice(1) }
                : edit === 'append'
                  ? { cards: [...cards, { heading: `new${step}` }] }
                  : edit === 'empty'
                    ? { cards: [] }
                    : edit === 'cardsOnly'
                      ? { cards }
                      : {};
    const view = await request(
      'GET',
      `/api/admin/content/${target.model}/${target.id}?locale=${locale}`,
      manifest.adminToken,
    );
    const version = isRecord(view.body) && typeof view.body.version === 'number' ? view.body.version : null;
    const pre =
      op === 'create'
        ? null
        : { ...(await preOf(caller, target, locale, body)), contentMatch: contentMatchOf(data, body) };
    const baseline = op === 'create' ? undefined : await baselineOf(target.id, target.model);
    const response =
      op === 'create'
        ? caller === 'admin'
          ? await request('POST', `/api/admin/content/${target.model}?locale=en`, token, {
              locale: 'en',
              data: body,
            })
          : await request('POST', `/api/content/${plural}?locale=en`, token, { locale: 'en', data: body })
        : caller === 'admin'
          ? await request('PUT', `/api/admin/content/${target.model}/${target.id}?locale=${locale}`, token, {
              locale,
              expectedVersion: version,
              data: body,
            })
          : await request('PUT', `/api/content/${plural}/${target.id}?locale=${locale}`, token, {
              locale,
              expectedVersion: version,
              data: body,
            });
    // A created entry's ID is named before anything is normalized (the sides create different IDs).
    if (op === 'create' && response.status < 300 && isRecord(response.body)) {
      const newId = (
        typeof response.body.id === 'string'
          ? response.body.id
          : isRecord(response.body.data)
            ? response.body.data.id
            : undefined
      ) as string | undefined;
      if (newId && !created.has(newId)) {
        created.set(newId, `created-${created.size}`);
      }
    }
    let observedId = target.id;
    let observedModel = target.model;
    if (op === 'create' && response.status < 300 && isRecord(response.body)) {
      const newId = (
        typeof response.body.id === 'string'
          ? response.body.id
          : isRecord(response.body.data)
            ? response.body.data.id
            : undefined
      ) as string | undefined;
      if (newId) {
        entries.push({ id: newId, model: target.model });
        observedId = newId;
        observedModel = target.model;
      }
    }
    steps.push({
      label: `${label} ${edit}`,
      ...(op === 'create' && observedId !== target.id ? { createdEntry: entries.length - 1 } : {}),
      pre,
      ...(baseline ? { baseline } : {}),
      sent: body,
      ...outcomeOf(response),
      entry: await observeEntry(observedId, observedModel),
    });
  }
  return steps;
};

describe(`main differential: ${PHASE}`, () => {
  it(PHASE, async () => {
    const { db, testApp } = await open();
    try {
      if (PHASE === 'seed') {
        writeFileSync(MANIFEST, JSON.stringify(await seed(testApp, db), null, 1));
      } else {
        const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
        writeFileSync(OUT, JSON.stringify(await replay(testApp, db, manifest), null, 1));
      }
    } finally {
      await testApp.app.close();
      await db.destroy().catch(() => undefined);
    }
  });
});
