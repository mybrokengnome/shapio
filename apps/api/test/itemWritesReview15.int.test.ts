import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, runContentSchemaJobs, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type Data = Record<string, unknown>;

type Model = 'r15d' | 'r15n';
type Kill = 'purge' | 'softDelete';
type Twin = 'dead' | 'unpublished';
type Row = 'appIds' | 'appNoIds' | 'appEcho' | 'topEcho' | 'adminToken' | 'adminApi';

const MODELS: readonly Model[] = ['r15d', 'r15n'];
const KILLS: readonly Kill[] = ['purge', 'softDelete'];
const ROWS: readonly Row[] = ['appIds', 'appNoIds', 'appEcho', 'topEcho', 'adminToken', 'adminApi'];

/** The answer a caller gets, without what differs between any two entries (IDs, times, versions). */
const answerOf = (statusCode: number, body: string) => {
  const parsed = JSON.parse(body) as { error?: { code: string; details?: { issues?: Data[] } } };
  return {
    statusCode,
    code: parsed.error?.code ?? null,
    issues: (parsed.error?.details?.issues ?? []).map((issue) => [issue.path, issue.code]),
  };
};

/**
 * The fifteenth review (plan item-ids): a relation target the server keeps for a caller (hidden behind what it
 * read) is never kept once it is deleted. It is dropped, as the same write before 0.9.0 drops it, so the save
 * that publishes a type without drafts never fails on it, and whether a hidden target was deleted or is only
 * unpublished never changes an answer.
 */
describe('item writes: fifteenth review, kept relation targets that were deleted', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let reader: AppSessionBody;
  /** A published entry every card's many-relation also points at. */
  let live: string;
  const entries = new Map<string, { id: string; target: string }>();
  const keyOf = (model: Model, kill: Kill, row: Row, twin: Twin) => `${model}:${kill}:${row}:${twin}`;

  const request = (method: 'GET' | 'PUT', url: string, token: string | null, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const adminView = async (model: Model, id: string) =>
    expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
  const footprint = async (id: string) => ({
    heads: await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'version', 'revision_id'])
      .where('entry_id', '=', id)
      .orderBy('state')
      .execute(),
    events: (
      await database.current.db
        .selectFrom('outbox_events')
        .select('id')
        .where('aggregate_id', '=', id)
        .execute()
    ).length,
  });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '100000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expect([201, 409]).toContain(
      (await admin.post('/api/admin/locales', { code: 'fr', label: 'French' })).statusCode,
    );
    const thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r15thing',
      label: 'R15 thing',
      localized: true,
      fields: [{ apiKey: 'name', label: 'Name', type: 'string', localized: true }],
    });
    const relation = (apiKey: string, cardinality: 'one' | 'many') => ({
      apiKey,
      label: apiKey,
      type: 'relation',
      settings: { target: thing.definition.id, cardinality },
    });
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'r15_card',
        label: 'R15 card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          relation('rel', 'one'),
          relation('rels', 'many'),
        ],
      },
      'components',
    );
    const fields = [
      { apiKey: 'title', label: 'Title', type: 'string' },
      relation('top', 'one'),
      {
        apiKey: 'cards',
        label: 'Cards',
        type: 'component',
        settings: { component: card.definition.id, repeatable: true },
      },
    ];
    const r15d = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r15d',
      label: 'R15 d',
      fields,
    });
    const r15n = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r15n',
      label: 'R15 n',
      draftAndPublish: false,
      fields,
    });
    reader = await signUp(testApp.app);
    const grants = [
      ...[r15d, r15n].flatMap((model) => [
        { action: 'read' as const, modelId: model.definition.id },
        { action: 'update' as const, modelId: model.definition.id },
      ]),
      { action: 'read' as const, modelId: thing.definition.id },
    ];
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${reader.user.id}`,
        payload: { roleIds: [await createAppRole(database.current.db, grants)] },
      }),
      200,
    );
    const makeThing = async (locale: 'en' | 'fr', published: boolean) => {
      const created = expectStatus(
        await admin.post(`/api/admin/content/r15thing?locale=${locale}`, { locale, data: { name: 'n' } }),
        201,
      ).json<EntryBody>();
      if (published) {
        expectStatus(
          await admin.post(`/api/admin/content/r15thing/${created.id}/publish`, { locales: [locale] }),
          200,
        );
      }
      return created.id;
    };
    live = await makeThing('en', true);
    const softDeleted: string[] = [];
    for (const model of MODELS) {
      for (const kill of KILLS) {
        for (const row of ROWS) {
          for (const twin of ['dead', 'unpublished'] as const) {
            // The dead twin's target lives only in `fr` (purged with the locale) or is soft-deleted later.
            const target =
              twin === 'unpublished'
                ? await makeThing('en', false)
                : await makeThing(kill === 'purge' ? 'fr' : 'en', true);
            if (twin === 'dead' && kill === 'softDelete') {
              softDeleted.push(target);
            }
            const data =
              row === 'topEcho'
                ? { title: 't', top: target, cards: [] }
                : {
                    title: 't',
                    cards: [{ heading: 'a', rel: target, rels: [live, target] }, { heading: 'b' }],
                  };
            const created = expectStatus(
              await admin.post(`/api/admin/content/${model}`, { data }),
              201,
            ).json<EntryBody>();
            if (model === 'r15d') {
              expectStatus(await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {}), 200);
            }
            entries.set(keyOf(model, kill, row, twin), { id: created.id, target });
          }
        }
      }
    }
    expectStatus(
      await testApp.app.inject({
        method: 'DELETE',
        url: '/api/admin/locales/fr?acknowledgeDestructive=true',
        headers: bearer(adminToken),
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
    await database.current.db
      .updateTable('entries')
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where('id', 'in', softDeleted)
      .execute();
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  /** One row on one twin: the answer, what is stored after it, and whether the write recorded anything. */
  const run = async (model: Model, kill: Kill, row: Row, twin: Twin) => {
    const { id, target } = entries.get(keyOf(model, kill, row, twin)) as { id: string; target: string };
    const token = row === 'adminToken' ? adminToken : reader.accessToken;
    const read =
      row === 'adminApi'
        ? (await adminView(model, id)).data
        : expectStatus(await request('GET', `/api/content/${model}s/${id}`, token), 200).json<{
            data: Data;
          }>().data;
    const cards = (read.cards as Item[]).map((item, index) => {
      const { id: _id, ...rest } = item;
      const sent = row === 'appNoIds' ? rest : item;
      return index === 1 && row !== 'appEcho' ? { ...sent, heading: 'b2' } : sent;
    });
    const body = row === 'topEcho' ? { title: 'new', top: read.top ?? null } : { title: read.title, cards };
    const before = await footprint(id);
    const version = (await adminView(model, id)).version;
    const response =
      row === 'adminApi'
        ? await admin.put(`/api/admin/content/${model}/${id}`, { expectedVersion: version, data: body })
        : await request('PUT', `/api/content/${model}s/${id}`, token, {
            expectedVersion: version,
            data: body,
          });
    const after = (await adminView(model, id)).data;
    const name = (value: unknown) => (value === target ? 'T' : value === live ? 'L' : (value ?? null));
    return {
      answer: answerOf(response.statusCode, response.body),
      changed: JSON.stringify(await footprint(id)) !== JSON.stringify(before),
      top: name(after.top),
      cards: ((after.cards ?? []) as Item[]).map((item) => [
        item.heading,
        name(item.rel),
        ((item.rels ?? []) as unknown[]).map(name),
      ]),
    };
  };

  const cases = MODELS.flatMap((model) => KILLS.map((kill) => [model, kill] as const));

  it.each(cases)(
    '%s after %s: an app user editing an item, with ids: the dead target is dropped',
    async (model, kill) => {
      const dead = await run(model, kill, 'appIds', 'dead');
      const unpublished = await run(model, kill, 'appIds', 'unpublished');
      expect(dead.answer).toEqual({ statusCode: 200, code: null, issues: [] });
      expect(unpublished.answer).toEqual(dead.answer);
      expect(dead.cards).toEqual([
        ['a', null, ['L']],
        ['b2', null, []],
      ]);
      expect(unpublished.cards).toEqual([
        ['a', 'T', ['L', 'T']],
        ['b2', null, []],
      ]);
    },
  );

  it.each(cases)(
    '%s after %s: an app user editing an item without ids: twins answer the same',
    async (model, kill) => {
      const dead = await run(model, kill, 'appNoIds', 'dead');
      const unpublished = await run(model, kill, 'appNoIds', 'unpublished');
      expect(unpublished.answer).toEqual(dead.answer);
      expect(unpublished.changed).toBe(dead.changed);
      if (dead.answer.statusCode === 200) {
        expect(dead.cards).toEqual([
          ['a', null, ['L']],
          ['b2', null, []],
        ]);
      } else {
        expect(dead.changed).toBe(false);
      }
    },
  );

  it.each(cases)(
    '%s after %s: an app user sending its read back unchanged: nothing written for either twin',
    async (model, kill) => {
      for (const twin of ['dead', 'unpublished'] as const) {
        const result = await run(model, kill, 'appEcho', twin);
        expect(result.answer, twin).toEqual({ statusCode: 200, code: null, issues: [] });
        expect(result.changed, twin).toBe(false);
      }
    },
  );

  it.each(cases)(
    '%s after %s: `top: null` sent back with a new title: 200, the dead target cleared',
    async (model, kill) => {
      const dead = await run(model, kill, 'topEcho', 'dead');
      const unpublished = await run(model, kill, 'topEcho', 'unpublished');
      expect(dead.answer).toEqual({ statusCode: 200, code: null, issues: [] });
      expect(unpublished.answer).toEqual(dead.answer);
      expect(dead.top).toBeNull();
      expect(unpublished.top).toBe('T');
    },
  );

  it.each(cases)(
    '%s after %s: an admin token on the delivery API editing an item: the dead target is dropped',
    async (model, kill) => {
      const dead = await run(model, kill, 'adminToken', 'dead');
      expect(dead.answer).toEqual({ statusCode: 200, code: null, issues: [] });
      expect(dead.cards).toEqual([
        ['a', null, ['L']],
        ['b2', null, []],
      ]);
    },
  );

  it.each(cases)(
    '%s after %s: the admin API sending the dead target back is refused, as before 0.9.0',
    async (model, kill) => {
      const dead = await run(model, kill, 'adminApi', 'dead');
      expect(dead.answer.statusCode).toBe(422);
      expect(dead.answer.issues).toEqual(
        expect.arrayContaining([['/cards/0/rel', 'RELATION_TARGET_MISSING']]),
      );
      expect(dead.changed).toBe(false);
      const unpublished = await run(model, kill, 'adminApi', 'unpublished');
      expect(unpublished.answer).toEqual({ statusCode: 200, code: null, issues: [] });
    },
  );
});
