import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createDb } from '../../../src/db/index.js';
import { migrateToLatest } from '../../../src/db/migrator.js';
import { bearer, createAppRole, loginAppUser, setPublicGrants, signUp } from '../appUsers.js';
import { createDefinition, expectStatus, type GrantSpec, type ModelBody } from '../content.js';
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
  entries: Array<{ id: string; model: 'doc' | 'ndoc'; ahead?: string }>;
  things: { published: string; unpublished: string };
  /** Field ID → API ID, so stored data compares by field name (diff.mjs keeps comparing untouched fields). */
  fieldKeys: Record<string, string>;
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
  const models: ModelBody[] = [doc, ndoc];
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
    entries.push({ id, model });
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
  const fieldKeys = Object.fromEntries(
    [chip, card, box, doc, ndoc].flatMap((model) =>
      model.definition.fields.map((field) => [field.id, field.apiKey]),
    ),
  );
  return {
    adminToken,
    users: { reader: reader.email, updateOnly: updateOnly.email, owner: owner.email },
    entries,
    things,
    fieldKeys,
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
  const steps: Json[] = [];
  const random = prng(SEED * 7919);
  const ahead = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.ahead);
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
    const op = random.pick(['read', 'write', 'write', 'write', 'create', 'echo', 'echo'] as const);
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
