import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { PRIMARY_SITE_ID } from '../../src/constants/sites.js';
import { bearer, createAppRole, setPublicGrants, signUp, type AppSessionBody } from './appUsers.js';
import {
  createDefinition,
  createRole,
  expectStatus,
  runContentSchemaJobs,
  type FieldBody,
  type GrantSpec,
  type ModelBody,
} from './content.js';
import { createTestApp, type TestApp } from './createTestApp.js';
import { graphql, GRAPHQL_ENV } from './graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './schemaAdmin.js';
import { useTestDatabase } from './testDatabase.js';

/**
 * The world of the model-based item-write fuzz (`itemWriteModel.int.test.ts`): one schema with every kind of
 * component value, an older schema version to write through, two locales, relation targets in every state, and
 * one caller of every kind. Everything goes through the HTTP API (REST, GraphQL, admin) of a real app on a real
 * database; the only direct database access is reading heads, revisions and events, and the few stored states
 * no API can make (legacy items without `__id`, values of a field deprecated since).
 *
 * Schema (today; the older version V differs as noted):
 *   chip { zv, zh (private) }                       nested list items
 *   tag  { label, tnote (private) }                 the zone's second component
 *   box  { label, items: chip[] }                   a single component holding a nested list
 *   card { heading, note (private), count (number at V, integer today: read-only through V), old (deprecated
 *          since V), extra (added since V), rel (relation → thing), pic (media), data (json), chips: chip[] }
 *   doc (localized) { title (localized), cards: card[] (shared), lchips: chip[] (localized), hero: box,
 *          zone: [card | tag], secretCard: card (private top-level) }
 *   plain { title, links: line[], one: line }       nothing hidden from anyone (compatibility)
 *   thing { name }                                  relation targets
 */

export type Caller = {
  name: string;
  /** Who: the admin API, an admin token on the delivery API, an app user, anonymous, a pinned token. */
  kind: 'admin' | 'adminToken' | 'user' | 'anon' | 'pinned';
  /** Bearer credential; null for anonymous. */
  token: string | null;
  /** May read entries (through the delivery API, or the admin API). */
  reads: boolean;
  /** May update. */
  updates: boolean;
  /** Reads the draft (the admin API) rather than the published head. */
  readsDraft: boolean;
  /** Always writes and reads through V (a token pinned to it). */
  pinned?: boolean;
  /** Only its own entries (`ownedByPrincipal`). */
  ownOnly?: boolean;
  /** The app user's ID (owner of entries it creates). */
  userId?: string;
};

export type Response = { status: number; body: unknown; raw: string };

type Fields<K extends string> = Record<K, string>;
type DocFields = Fields<
  | 'title'
  | 'cards'
  | 'lchips'
  | 'hero'
  | 'zone'
  | 'secretCard'
  | 'ref'
  | 'refs'
  | 'secretRef'
  | 'madePrivate'
  | 'deprecatedTop'
  | 'retypedTop'
  | 'addedTop'
>;

export type World = {
  testApp: TestApp;
  admin: SchemaClient;
  adminToken: string;
  db: ReturnType<typeof useTestDatabase>['current']['db'];
  /** The older version's token (`?schemaVersion=`), and its number (a pin). */
  versionToken: string;
  versionNumber: number;
  models: { doc: ModelBody; ndoc: ModelBody; plain: ModelBody; thing: ModelBody };
  /** The doc-like model the current run writes (`useModel`): its API ID, plural, GraphQL names, field IDs. */
  docKey: 'doc' | 'ndoc';
  docPlural: string;
  gqlNames: { update: string; create: string; input: string; query: string };
  draftAndPublish: boolean;
  /** IDs of fields removed since V (their values may still be stored): per doc-like model, and in card. */
  removed: { doc: string; ndoc: string; card: string };
  /** Field IDs of both doc-like models. */
  docs: Record<'doc' | 'ndoc', DocFields>;
  components: { chip: ModelBody; tag: ModelBody; box: ModelBody; card: ModelBody; line: ModelBody };
  /** Field IDs by API ID. */
  /** The current model's field IDs (`useModel`). */
  doc: DocFields;
  card: Fields<
    | 'heading'
    | 'note'
    | 'count'
    | 'old'
    | 'extra'
    | 'rel'
    | 'rels'
    | 'anyRels'
    | 'secretRel'
    | 'pic'
    | 'data'
    | 'chips'
  >;
  chip: Fields<'zv' | 'zh'>;
  tag: Fields<'label' | 'tnote'>;
  box: Fields<'label' | 'items'>;
  /** Every component field's API ID by its ID (storage keys to API keys). */
  apiKeyOf: Map<string, string>;
  /** Relation targets: published, never published, deleted. */
  things: { published: string; draft: string; deleted: string };
  /** Media assets (inserted raw, standing in for uploads): one public, one private. */
  media: { public: string; private: string };
  callers: Record<
    'admin' | 'adminToken' | 'reader' | 'updateOnly' | 'masked' | 'owner' | 'anon' | 'pinned' | 'limited',
    Caller
  >;
  /** Sets the public role's grants: update and create on plain entries, and (with `docs`) on docs too. */
  publicGrants: (docs: boolean) => Promise<void>;
  /** Another app user (owns entries the owner caller may not touch). */
  stranger: AppSessionBody;
  request: (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    token: string | null,
    payload?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  gql: (
    query: string,
    variables: Record<string, unknown>,
    token: string | null,
    version: boolean,
  ) => Promise<Response>;
};

const fieldsOf = <K extends string>(model: ModelBody, keys: readonly K[]): Fields<K> =>
  Object.fromEntries(
    keys.map((key) => {
      const field = model.definition.fields.find((candidate) => candidate.apiKey === key);
      if (!field) {
        throw new Error(`${model.definition.apiKey} has no ${key}`);
      }
      return [key, field.id];
    }),
  ) as Fields<K>;

const toResponse = (response: { statusCode: number; body: string }): Response => {
  let body: unknown;
  try {
    body = JSON.parse(response.body) as unknown;
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body, raw: response.body };
};

/** Builds the world once per test file (`beforeAll`), on the test database of `useTestDatabase`. */
export const itemModelWorld = (): World => {
  const database = useTestDatabase();
  const w = {} as World;
  beforeAll(async () => {
    w.testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '1000000' },
    });
    w.db = database.current.db;
    w.adminToken = await createRoleToken(w.db);
    w.admin = schemaClient(w.testApp.app, w.adminToken);
    w.request = async (method, url, token, payload, headers = {}) =>
      toResponse(
        await w.testApp.app.inject({
          method,
          url,
          headers: { ...(token ? bearer(token) : {}), ...headers },
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        }),
      );
    w.gql = async (query, variables, token, version) => {
      const result = await graphql(w.testApp.app, query, {
        headers: {
          ...(token ? bearer(token) : {}),
          ...(version ? { 'shapio-schema-version': w.versionToken } : {}),
        },
        variables,
      });
      return { status: result.statusCode, body: result.body, raw: JSON.stringify(result.body) };
    };
    expectStatus(await w.admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);

    const thing = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: 'thing',
      label: 'Thing',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const chip = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: 'chip',
        label: 'Chip',
        fields: [
          { apiKey: 'zv', label: 'Zv', type: 'string' },
          { apiKey: 'zh', label: 'Zh', type: 'string', public: false },
        ],
      },
      'components',
    );
    const tag = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: 'tag',
        label: 'Tag',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'tnote', label: 'Tnote', type: 'string', public: false },
        ],
      },
      'components',
    );
    const box = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: 'box',
        label: 'Box',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: chip.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const card = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
          { apiKey: 'count', label: 'Count', type: 'number' },
          { apiKey: 'old', label: 'Old', type: 'string' },
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
          // Any entry (polymorphic), many; and a private relation (a hidden place an entry ID can sit in).
          {
            apiKey: 'anyRels',
            label: 'Any rels',
            type: 'relation',
            settings: { target: '*', cardinality: 'many' },
          },
          {
            apiKey: 'secretRel',
            label: 'Secret rel',
            type: 'relation',
            public: false,
            settings: { target: thing.definition.id, cardinality: 'one' },
          },
          { apiKey: 'pic', label: 'Pic', type: 'media' },
          // Public at V and private since; present at V and removed since.
          { apiKey: 'pvt', label: 'Pvt', type: 'string' },
          { apiKey: 'rmv', label: 'Rmv', type: 'string' },
          { apiKey: 'data', label: 'Data', type: 'json' },
          {
            apiKey: 'chips',
            label: 'Chips',
            type: 'component',
            settings: { component: chip.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const line = await createDefinition(
      w.admin,
      {
        kind: 'component',
        apiKey: 'line',
        label: 'Line',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    // Doc (draft and publish) and ndoc (published on every write), the same fields. At V the top level also holds
    // fields changed since: made private, deprecated, removed, retyped (number → integer); one is added since.
    const docFields = () => [
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
        settings: { components: [card.definition.id, tag.definition.id] },
      },
      {
        apiKey: 'secretCard',
        label: 'Secret card',
        type: 'component',
        public: false,
        settings: { component: card.definition.id },
      },
      // Top-level relations: one to a thing, many to any entry, and a private one.
      {
        apiKey: 'ref',
        label: 'Ref',
        type: 'relation',
        settings: { target: thing.definition.id, cardinality: 'one' },
      },
      { apiKey: 'refs', label: 'Refs', type: 'relation', settings: { target: '*', cardinality: 'many' } },
      {
        apiKey: 'secretRef',
        label: 'Secret ref',
        type: 'relation',
        public: false,
        settings: { target: thing.definition.id, cardinality: 'one' },
      },
      { apiKey: 'madePrivate', label: 'Made private', type: 'string' },
      { apiKey: 'deprecatedTop', label: 'Deprecated top', type: 'string' },
      { apiKey: 'removedTop', label: 'Removed top', type: 'string' },
      { apiKey: 'retypedTop', label: 'Retyped top', type: 'number' },
    ];
    const doc = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: 'doc',
      label: 'Doc',
      localized: true,
      fields: docFields(),
    });
    const ndoc = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: 'ndoc',
      label: 'Ndoc',
      localized: true,
      draftAndPublish: false,
      fields: docFields(),
    });
    const plain = await createDefinition(w.admin, {
      kind: 'collection',
      apiKey: 'plain',
      label: 'Plain',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'links',
          label: 'Links',
          type: 'component',
          settings: { component: line.definition.id, repeatable: true },
        },
        { apiKey: 'one', label: 'One', type: 'component', settings: { component: line.definition.id } },
      ],
    });

    // Relation targets: published, never published, deleted.
    const thingOf = async (name: string, publish: boolean) => {
      const created = expectStatus(
        await w.admin.post('/api/admin/content/thing', { data: { name } }),
        201,
      ).json<{ id: string }>();
      if (publish) {
        expectStatus(await w.admin.post(`/api/admin/content/thing/${created.id}/publish`, {}), 200);
      }
      return created.id;
    };
    w.things = {
      published: await thingOf('published', true),
      draft: await thingOf('draft', false),
      deleted: await thingOf('deleted', true),
    };

    // Media: two assets inserted raw (an upload's row without its file), one private.
    const asset = async (visibility: string) => {
      const id = randomUUID();
      await w.db
        .insertInto('media_assets')
        .values({
          id,
          site_id: PRIMARY_SITE_ID,
          storage_driver: 'local',
          storage_key: `${visibility}/${id}/0123456789abcdef01234567/${visibility}.png`,
          original_filename: `${visibility}.png`,
          mime_type: 'image/png',
          size_bytes: 1,
          status: 'ready',
          visibility,
        })
        .execute();
      return id;
    };
    w.media = { public: await asset('public'), private: await asset('private') };

    // V: the version older clients write through.
    w.versionToken = expectStatus(await w.admin.get('/api/snapshots/current'), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    w.versionNumber = Number(w.versionToken.split(':').pop());
    // Since V: count number → integer (read-only through V), old deprecated, extra added.
    const current = expectStatus(await w.admin.get(`/api/admin/components/${card.definition.id}`), 200).json<{
      definition: ModelBody['definition'];
      version: number;
    }>();
    const changed = await w.admin.put(`/api/admin/components/${card.definition.id}`, {
      definition: {
        ...current.definition,
        fields: [
          ...current.definition.fields
            .map((field: FieldBody) =>
              field.apiKey === 'count'
                ? { ...field, type: 'integer' }
                : field.apiKey === 'old'
                  ? { ...field, deprecated: true }
                  : field.apiKey === 'pvt'
                    ? { ...field, public: false }
                    : field,
            )
            .filter((field: FieldBody) => field.apiKey !== 'rmv'),
          { apiKey: 'extra', label: 'Extra', type: 'string' },
        ],
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    if (changed.statusCode >= 300) {
      throw new Error(`changing card: ${changed.body}`);
    }
    await runContentSchemaJobs(w.db);
    const changeTop = async (model: ModelBody) => {
      const now = expectStatus(await w.admin.get(`/api/admin/models/${model.definition.id}`), 200).json<{
        definition: ModelBody['definition'];
        version: number;
      }>();
      const response = await w.admin.put(`/api/admin/models/${model.definition.id}`, {
        definition: {
          ...now.definition,
          fields: [
            ...now.definition.fields
              .filter((field: FieldBody) => field.apiKey !== 'removedTop')
              .map((field: FieldBody) =>
                field.apiKey === 'madePrivate'
                  ? { ...field, public: false }
                  : field.apiKey === 'deprecatedTop'
                    ? { ...field, deprecated: true }
                    : field.apiKey === 'retypedTop'
                      ? { ...field, type: 'integer' }
                      : field,
              ),
            { apiKey: 'addedTop', label: 'Added top', type: 'string' },
          ],
        },
        expectedVersion: now.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      });
      if (response.statusCode >= 300) {
        throw new Error(`changing ${model.definition.apiKey}: ${response.body}`);
      }
      await runContentSchemaJobs(w.db);
      return expectStatus(
        await w.admin.get(`/api/admin/models/${model.definition.id}`),
        200,
      ).json<ModelBody>();
    };
    const idOf = (model: ModelBody, key: string) =>
      model.definition.fields.find((field) => field.apiKey === key)?.id as string;
    w.removed = { doc: idOf(doc, 'removedTop'), ndoc: idOf(ndoc, 'removedTop'), card: idOf(card, 'rmv') };
    const docNow = await changeTop(doc);
    const ndocNow = await changeTop(ndoc);
    const cardNow = expectStatus(
      await w.admin.get(`/api/admin/components/${card.definition.id}`),
      200,
    ).json<ModelBody>();
    // The deleted target: deleted after V, so stored values may still point at it.
    expectStatus(await w.admin.delete(`/api/admin/content/thing/${w.things.deleted}`), 204);

    w.apiKeyOf = new Map(
      [chip, tag, box, cardNow, line].flatMap((component) =>
        component.definition.fields.map((field) => [field.id, field.apiKey] as [string, string]),
      ),
    );
    w.models = { doc: docNow, ndoc: ndocNow, plain, thing };
    w.components = { chip, tag, box, card: cardNow, line };
    const docKeys = [
      'title',
      'cards',
      'lchips',
      'hero',
      'zone',
      'secretCard',
      'ref',
      'refs',
      'secretRef',
      'madePrivate',
      'deprecatedTop',
      'retypedTop',
      'addedTop',
    ] as const;
    w.docs = { doc: fieldsOf(docNow, docKeys), ndoc: fieldsOf(ndocNow, docKeys) };
    useModel(w, 'doc');
    w.card = fieldsOf(cardNow, [
      'heading',
      'note',
      'count',
      'old',
      'extra',
      'rel',
      'rels',
      'anyRels',
      'secretRel',
      'pic',
      'data',
      'chips',
    ]);
    w.chip = fieldsOf(chip, ['zv', 'zh']);
    w.tag = fieldsOf(tag, ['label', 'tnote']);
    w.box = fieldsOf(box, ['label', 'items']);

    // Callers.
    const userWith = async (grants: GrantSpec[]) => {
      const session = await signUp(w.testApp.app);
      expectStatus(
        await w.admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${session.user.id}`,
          payload: { roleIds: [await createAppRole(w.db, grants)] },
        }),
        200,
      );
      return session;
    };
    const all = (actions: GrantSpec['action'][], extra: Partial<GrantSpec> = {}): GrantSpec[] =>
      [doc, ndoc, plain].flatMap((model) =>
        actions.map((action) => ({ action, modelId: model.definition.id, ...extra })),
      );
    // Readers may read relation targets that are published (the others stay invisible to them).
    const things: GrantSpec = { action: 'read', modelId: thing.definition.id };
    const reader = await userWith([...all(['read', 'create', 'update']), things]);
    const updateOnly = await userWith(all(['create', 'update']));
    const masked = await userWith([
      ...(['doc', 'ndoc'] as const).flatMap((key): GrantSpec[] => [
        {
          action: 'read',
          modelId: w.models[key].definition.id,
          fieldIds: [w.docs[key].title, w.docs[key].cards, w.docs[key].lchips, w.docs[key].zone],
        },
        { action: 'update', modelId: w.models[key].definition.id },
        { action: 'create', modelId: w.models[key].definition.id },
      ]),
      things,
    ]);
    const owner = await userWith([
      ...all(['read', 'update'], { condition: 'ownedByPrincipal' }),
      ...all(['create']),
      things,
    ]);
    // Reads everything, may write the component fields but not the title (a write grant naming fields).
    const limited = await userWith([
      ...(['doc', 'ndoc'] as const).flatMap((key): GrantSpec[] => [
        { action: 'read', modelId: w.models[key].definition.id },
        {
          action: 'update',
          modelId: w.models[key].definition.id,
          fieldIds: [w.docs[key].cards, w.docs[key].lchips, w.docs[key].hero, w.docs[key].zone],
        },
      ]),
      things,
    ]);
    w.stranger = await userWith(all(['read', 'create', 'update'], { condition: 'ownedByPrincipal' }));
    // Anonymous may update and create plain entries, not read. The public role applies to every signed-in user
    // too, so its grant on docs is given only while an anonymous request runs (`withAnonymousDocGrants`).
    w.publicGrants = (docs) =>
      setPublicGrants(w.db, [
        ...all(['update', 'create']).filter((grant) => docs || grant.modelId === plain.definition.id),
      ]);
    await w.publicGrants(false);
    // A token pinned to V (an admin-kind role that may read and update the models).
    const pinnedRole = await createRole(w.db, 'admin', all(['read', 'update', 'create']));
    const pinned = expectStatus(
      await w.admin.post('/api/admin/tokens', {
        name: 'pinned to V',
        roleId: pinnedRole,
        pinnedSchemaVersion: w.versionNumber,
      }),
      201,
    ).json<{ token: string }>().token;
    w.callers = {
      admin: {
        name: 'admin',
        kind: 'admin',
        token: w.adminToken,
        reads: true,
        updates: true,
        readsDraft: true,
      },
      adminToken: {
        name: 'adminToken',
        kind: 'adminToken',
        token: w.adminToken,
        reads: true,
        updates: true,
        readsDraft: false,
      },
      reader: {
        name: 'reader',
        kind: 'user',
        token: reader.accessToken,
        reads: true,
        updates: true,
        readsDraft: false,
        userId: reader.user.id,
      },
      updateOnly: {
        name: 'updateOnly',
        kind: 'user',
        token: updateOnly.accessToken,
        reads: false,
        updates: true,
        readsDraft: false,
        userId: updateOnly.user.id,
      },
      masked: {
        name: 'masked',
        kind: 'user',
        token: masked.accessToken,
        reads: true,
        updates: true,
        readsDraft: false,
        userId: masked.user.id,
      },
      owner: {
        name: 'owner',
        kind: 'user',
        token: owner.accessToken,
        reads: true,
        updates: true,
        readsDraft: false,
        ownOnly: true,
        userId: owner.user.id,
      },
      anon: { name: 'anon', kind: 'anon', token: null, reads: false, updates: true, readsDraft: false },
      limited: {
        name: 'limited',
        kind: 'user',
        token: limited.accessToken,
        reads: true,
        updates: true,
        readsDraft: false,
        userId: limited.user.id,
      },
      pinned: {
        name: 'pinned',
        kind: 'pinned',
        token: pinned,
        reads: true,
        updates: true,
        readsDraft: false,
        pinned: true,
      },
    };
  });
  afterAll(async () => {
    await w.testApp.app.close();
  });
  return w;
};

// ---------------------------------------------------------------------------------------------------------
// Raw storage (reading, and the states no API makes)

export type Head = {
  locale: string;
  state: string;
  data: Record<string, unknown>;
  version: number;
  revision: string;
};

export const headsOf = async (w: World, entryId: string): Promise<Head[]> => {
  const rows = await w.db
    .selectFrom('entry_heads')
    .select(['locale', 'state', 'data', 'version', 'revision_id'])
    .where('entry_id', '=', entryId)
    .execute();
  return rows
    .map((row) => ({
      locale: row.locale,
      state: row.state,
      data: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>,
      version: Number(row.version),
      revision: row.revision_id,
    }))
    .sort((a, b) => `${a.locale}/${a.state}`.localeCompare(`${b.locale}/${b.state}`));
};

/** Rewrites one head's stored data (legacy items, deprecated values, identical item IDs in twins). */
export const setHeadData = async (
  w: World,
  entryId: string,
  locale: string,
  state: string,
  data: Record<string, unknown>,
) => {
  await w.db
    .updateTable('entry_heads')
    .set({ data: data as never })
    .where('entry_id', '=', entryId)
    .where('locale', '=', locale)
    .where('state', '=', state as never)
    .execute();
};

export const revisionCount = async (w: World, entryId: string): Promise<number> =>
  (await w.db.selectFrom('content_revisions').select('id').where('entry_id', '=', entryId).execute()).length;

export const eventCount = async (w: World, entryId: string): Promise<number> =>
  (await w.db.selectFrom('outbox_events').select('id').where('aggregate_id', '=', entryId).execute()).length;

/** Runs `run` with anonymous update and create grants on docs (the public role applies to every app user). */
export const withAnonymousDocGrants = async <T>(
  w: World,
  caller: Caller,
  run: () => Promise<T>,
): Promise<T> => {
  if (caller.kind !== 'anon') {
    return run();
  }
  await w.publicGrants(true);
  try {
    return await run();
  } finally {
    await w.publicGrants(false);
  }
};

/** Points the world's current doc-like model at `doc` (draft and publish) or `ndoc` (published on every write). */
export const useModel = (w: World, key: 'doc' | 'ndoc') => {
  w.docKey = key;
  w.docPlural = `${key}s`;
  const type = key === 'doc' ? 'Doc' : 'Ndoc';
  w.gqlNames = { update: `update${type}`, create: `create${type}`, input: `${type}Input`, query: key };
  w.draftAndPublish = key === 'doc';
  w.doc = w.docs[key];
};
