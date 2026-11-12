import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { uploadAsset } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Data = Record<string, unknown>;
type Model = 'r17d' | 'r17n';
type Twin = 'hidden' | 'dead';
type Kind = 'relation' | 'media';
type Layout = 'listAndList' | 'listAndSingle' | 'listAndCard' | 'cardAndList';

const MODELS: readonly Model[] = ['r17d', 'r17n'];
const TWINS: readonly Twin[] = ['hidden', 'dead'];
const KINDS: readonly Kind[] = ['relation', 'media'];
const LAYOUTS: readonly Layout[] = ['listAndList', 'listAndSingle', 'listAndCard', 'cardAndList'];

/** The IDs of a relation or media value as a read shows it (media reads as objects). */
const idsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]).map(
    (item: unknown) => (typeof item === 'string' ? item : String((item as { id: string }).id)),
  );

/**
 * The seventeenth review (plan item-ids): sending back what was read changes nothing, whether a target the caller
 * cannot see was deleted or is only hidden, also when the same target sits in a field the body does not send; and an
 * entry already invalid as stored answers as before 0.9.0 for both.
 */
describe('item writes: seventeenth review, unchanged saves around deleted targets', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let reader: AppSessionBody;
  let live: { relation: string; media: string };
  const thingIds: string[] = [];

  const request = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(reader.accessToken),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const adminView = async (model: string, id: string) =>
    expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
  const footprint = async (id: string) =>
    JSON.stringify(
      await database.current.db
        .selectFrom('entry_heads')
        .select(['state', 'version', 'revision_id'])
        .where('entry_id', '=', id)
        .orderBy('state')
        .execute(),
    );

  /** A target of `kind`: a hidden one (an unpublished entry, a private asset), or one that will be deleted. */
  let makeTarget: (kind: Kind, twin: Twin) => Promise<string>;
  /** Deletes a target: a soft-deleted entry, or an asset an owner force-deletes. */
  let kill: (kind: Kind, id: string) => Promise<void>;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '100000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r17thing',
      label: 'R17 thing',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const many = (apiKey: string, settings: Data = {}) => ({
      apiKey,
      label: apiKey,
      type: 'relation',
      settings: { target: thing.definition.id, cardinality: 'many', ...settings },
    });
    const media = (apiKey: string, multiple: boolean) => ({
      apiKey,
      label: apiKey,
      type: 'media',
      settings: { multiple },
    });
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'r17_card',
        label: 'R17 card',
        fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }, many('rel'), media('files', true)],
      },
      'components',
    );
    const fields = [
      { apiKey: 'title', label: 'Title', type: 'string' },
      many('rel'),
      many('rel2'),
      { ...many('one'), settings: { target: thing.definition.id, cardinality: 'one' } },
      many('tags', { max: 1 }),
      media('files', true),
      media('files2', true),
      media('photo', false),
      {
        apiKey: 'cards',
        label: 'Cards',
        type: 'component',
        settings: { component: card.definition.id, repeatable: true },
      },
    ];
    const models = [
      await createDefinition(admin, { kind: 'collection', apiKey: 'r17d', label: 'R17 d', fields }),
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r17n',
        label: 'R17 n',
        draftAndPublish: false,
        fields,
      }),
    ];
    reader = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${reader.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [
              ...models.flatMap((model) => [
                { action: 'read' as const, modelId: model.definition.id },
                { action: 'update' as const, modelId: model.definition.id },
              ]),
              { action: 'read' as const, modelId: thing.definition.id },
            ]),
          ],
        },
      }),
      200,
    );
    const owner = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['owner'] }));
    let uploads = 0;
    makeTarget = async (kind, twin) => {
      if (kind === 'media') {
        uploads += 1;
        return (
          await uploadAsset(testApp.app, bearer(adminToken), {
            file: Buffer.from(`%PDF-1.7\n${uploads}\n%%EOF\n`),
            filename: `r17-${uploads}.pdf`,
            mimeType: 'application/pdf',
            visibility: twin === 'hidden' ? 'private' : 'public',
          })
        ).id;
      }
      const created = expectStatus(
        await admin.post('/api/admin/content/r17thing', { data: { name: 'n' } }),
        201,
      ).json<EntryBody>();
      if (twin === 'dead') {
        expectStatus(await admin.post(`/api/admin/content/r17thing/${created.id}/publish`, {}), 200);
      }
      thingIds.push(created.id);
      return created.id;
    };
    kill = async (kind, id) => {
      if (kind === 'media') {
        expectStatus(
          await testApp.app.inject({
            method: 'DELETE',
            url: `/api/admin/media/assets/${id}?force=true`,
            headers: owner.headers,
          }),
          204,
        );
      } else {
        await database.current.db
          .updateTable('entries')
          .set({ deleted_at: new Date(), updated_at: new Date() })
          .where('id', '=', id)
          .execute();
      }
    };
    live = { relation: await makeTarget('relation', 'dead'), media: await makeTarget('media', 'dead') };
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const create = async (model: Model, data: Data) => {
    const created = expectStatus(
      await admin.post(`/api/admin/content/${model}`, { data }),
      201,
    ).json<EntryBody>();
    if (model === 'r17d') {
      expectStatus(await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {}), 200);
    }
    return created.id;
  };

  /** The layout's data: the sent field holds [live, H], the unsent one holds H. */
  const layoutOf = (kind: Kind, layout: Layout, h: string): { data: Data; sent: string } => {
    const a = live[kind];
    const [list, list2, single, inCard] =
      kind === 'relation' ? ['rel', 'rel2', 'one', 'rel'] : ['files', 'files2', 'photo', 'files'];
    switch (layout) {
      case 'listAndList':
        return { data: { [list]: [a, h], [list2]: [h] }, sent: list };
      case 'listAndSingle':
        return { data: { [list]: [a, h], [single]: h }, sent: list };
      case 'listAndCard':
        return { data: { [list]: [a, h], cards: [{ heading: 'c', [inCard]: [h] }] }, sent: list };
      case 'cardAndList':
        return { data: { cards: [{ heading: 'c', [inCard]: [a, h] }], [list2]: [h] }, sent: 'cards' };
    }
  };
  /** Sends back what the reader read of `sent` (media as IDs), with `change` applied to the body. */
  const sendBack = async (
    model: Model,
    id: string,
    sent: string,
    change: (body: Data) => Data = (body) => body,
  ) => {
    const read = expectStatus(await request('GET', `/api/content/${model}s/${id}`), 200).json<{
      data: Data;
    }>().data;
    const value =
      sent === 'cards'
        ? (read.cards as Data[]).map((item) => ({
            ...item,
            ...(item.files === undefined ? {} : { files: idsOf(item.files) }),
          }))
        : sent.startsWith('files')
          ? idsOf(read[sent])
          : read[sent];
    const before = await footprint(id);
    const response = await request('PUT', `/api/content/${model}s/${id}`, {
      expectedVersion: (await adminView(model, id)).version,
      data: change({ [sent]: value }),
    });
    return { status: response.statusCode, body: response.body, wrote: (await footprint(id)) !== before };
  };

  it.each(
    KINDS.flatMap((kind) =>
      MODELS.flatMap((model) =>
        LAYOUTS.flatMap((layout) => TWINS.map((twin) => [kind, model, layout, twin] as const)),
      ),
    ),
  )(
    '%s, %s, %s, %s: sending back only the field that holds H changes nothing, though H is also in an unsent field',
    async (kind, model, layout, twin) => {
      const h = await makeTarget(kind, twin);
      const { data, sent } = layoutOf(kind, layout, h);
      const id = await create(model, { title: 't', ...data });
      if (twin === 'dead') {
        await kill(kind, h);
      }
      // What is stored, by target IDs (a private asset's read carries a signed URL that changes per read).
      const targets = async () => {
        const stored = (await adminView(model, id)).data;
        return ['rel', 'rel2', 'one', 'files', 'files2', 'photo', 'cards'].map((key) =>
          key === 'cards'
            ? ((stored.cards ?? []) as Data[]).map((item) => [idsOf(item.rel), idsOf(item.files)])
            : idsOf(stored[key]),
        );
      };
      const before = await targets();
      const result = await sendBack(model, id, sent);
      expect({ status: result.status, wrote: result.wrote }, result.body).toEqual({
        status: 200,
        wrote: false,
      });
      expect(await targets()).toEqual(before);
    },
  );

  it.each(KINDS)(
    '%s: an edit drops the deleted target where it was sent, and leaves the unsent field as stored',
    async (kind) => {
      const h = await makeTarget(kind, 'dead');
      const { data, sent } = layoutOf(kind, 'listAndList', h);
      const id = await create('r17d', { title: 't', ...data });
      await kill(kind, h);
      const result = await sendBack('r17d', id, sent, (body) => ({ ...body, title: 't2' }));
      expect(result.status, result.body).toBe(200);
      const after = (await adminView('r17d', id)).data;
      const unsent = kind === 'relation' ? 'rel2' : 'files2';
      expect(idsOf(after[sent])).toEqual([live[kind]]);
      expect(idsOf(after[unsent])).toEqual([h]);
    },
  );

  it.each(MODELS.flatMap((model) => TWINS.map((twin) => [model, twin] as const)))(
    '%s, %s: an entry already invalid as stored answers TOO_MANY to an unchanged save, as before 0.9.0',
    async (model, twin) => {
      const h = await makeTarget('relation', twin);
      const [b1, b2] = [await makeTarget('relation', 'dead'), await makeTarget('relation', 'dead')];
      const id = await create(model, { title: 't', tags: [b1], rel: [live.relation, h] });
      if (twin === 'dead') {
        await kill('relation', h);
      }
      // Stored with more tags than its `max` allows (as when the max was lowered after the save).
      const tagsField = (await adminView(model, id)).data;
      expect(tagsField.tags).toEqual([b1]);
      for (const head of await database.current.db
        .selectFrom('entry_heads')
        .select(['locale', 'state', 'data'])
        .where('entry_id', '=', id)
        .execute()) {
        const stored = (typeof head.data === 'string' ? JSON.parse(head.data) : head.data) as Data;
        const over = Object.fromEntries(
          Object.entries(stored).map(([key, value]) => [
            key,
            Array.isArray(value) && value.length === 1 && value[0] === b1 ? [b1, b2] : value,
          ]),
        );
        await database.current.db
          .updateTable('entry_heads')
          .set({ data: (typeof head.data === 'string' ? JSON.stringify(over) : over) as never })
          .where('entry_id', '=', id)
          .where('locale', '=', head.locale)
          .where('state', '=', head.state)
          .execute();
      }
      for (const change of [(body: Data) => body, (body: Data) => ({ ...body, title: 'changed' })]) {
        const read = expectStatus(await request('GET', `/api/content/${model}s/${id}`), 200).json<{
          data: Data;
        }>().data;
        const before = await footprint(id);
        const response = await request('PUT', `/api/content/${model}s/${id}`, {
          expectedVersion: (await adminView(model, id)).version,
          data: change({ title: read.title, tags: read.tags, rel: read.rel }),
        });
        expect(response.statusCode, response.body).toBe(422);
        expect(response.body).toContain('"path":"/tags","code":"TOO_MANY"');
        expect(await footprint(id)).toBe(before);
      }
    },
  );
});
