import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { createContentHooks } from '../src/content/hooks.js';
import { createContentPorts } from '../src/content/ports.js';
import type { SchemaContentPorts } from '../src/schema/planner/contentPorts.js';
import { createEntry } from '../src/services/contentEntries.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql } from './helpers/graphql.js';
import { createRoleToken, runSchemaJobs, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ChangeBody = {
  status: string;
  error: { step?: string; reason?: string; invalidCount?: number; sampleEntryIds?: string[] } | null;
};

/**
 * Content under live schema changes (brief §5, §10): the transitional write policy, required-field
 * validation and backfill, uniqueness backfill, value conversion, and concurrent uniqueness.
 */
describe('content and schema changes', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const model = async (apiKey: string, fields: unknown[]) =>
    createDefinition(admin, { kind: 'collection', apiKey, label: apiKey, fields });
  const reload = async (id: string) => (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
  const create = (apiKey: string, data: Record<string, unknown>) =>
    admin.post(`/api/admin/content/${apiKey}`, { data });
  const change = (current: ModelBody, fields: unknown[]) =>
    admin.put(`/api/admin/models/${current.definition.id}`, {
      definition: { ...current.definition, fields },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
  const changeStatus = async (changeId: string) =>
    (await admin.get(`/api/admin/schema/changes/${changeId}`)).json<ChangeBody>();

  /** Everything a model's content stores: heads, revisions and unique-registry rows, in key order. */
  const storageOf = async (modelId: string) => {
    const { db } = database.current;
    return {
      heads: await db
        .selectFrom('entry_heads')
        .selectAll()
        .where('model_id', '=', modelId)
        .orderBy('entry_id')
        .orderBy('locale')
        .orderBy('state')
        .execute(),
      revisions: await db
        .selectFrom('content_revisions')
        .selectAll()
        .where('entry_id', 'in', db.selectFrom('entries').select('id').where('model_id', '=', modelId))
        .orderBy('id')
        .execute(),
      unique: await db
        .selectFrom('unique_values')
        .selectAll()
        .where('model_id', '=', modelId)
        .orderBy('field_id')
        .orderBy('locale')
        .orderBy('state')
        .orderBy('value_hash')
        .execute(),
    };
  };

  it('concurrent writes of one unique value: exactly one wins', async () => {
    await model('coupon', [{ apiKey: 'code', label: 'Code', type: 'string', unique: true }]);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => create('coupon', { code: 'SAVE10' })),
    );
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 422)).toHaveLength(11);
    for (const response of responses.filter((candidate) => candidate.statusCode === 422)) {
      expect(response.json()).toMatchObject({
        error: { details: { issues: [{ path: '/code', code: 'NOT_UNIQUE' }] } },
      });
    }
    const rows = await database.current.db.selectFrom('unique_values').select('entry_id').execute();
    expect(new Set(rows.map((row) => row.entry_id)).size).toBe(1);
  });

  it('a required field without default is blocked by entries that lack it; with a default it is backfilled', async () => {
    const note = await model('note', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    const entry = expectStatus(await create('note', { title: 'n1' }), 201).json<EntryBody>();

    const blocked = await change(note, [
      ...note.definition.fields,
      { apiKey: 'summary', label: 'Summary', type: 'text', required: true },
    ]);
    expect(blocked.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    const failed = await changeStatus(blocked.json<{ changeId: string }>().changeId);
    expect(failed).toMatchObject({
      status: 'failed',
      error: { invalidCount: 1, sampleEntryIds: [entry.id] },
    });
    expect((await reload(note.definition.id)).version).toBe(1);

    const backfilled = await change(note, [
      ...note.definition.fields,
      { apiKey: 'summary', label: 'Summary', type: 'text', required: true, defaultValue: 'TBD' },
    ]);
    expect(backfilled.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await changeStatus(backfilled.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });
    expect((await admin.get(`/api/admin/content/note/${entry.id}`)).json<EntryBody>().data).toEqual({
      title: 'n1',
      summary: 'TBD',
    });
    // New entries get the default; clearing the now-required field is refused.
    expect((await create('note', { title: 'n2' })).json<EntryBody>().data).toEqual({
      title: 'n2',
      summary: 'TBD',
    });
    expect((await create('note', { title: 'n3', summary: null })).statusCode).toBe(422);
  });

  it('a write that lands between the scan and the activation is caught by the re-check', async () => {
    const memo = await model('memo', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    const response = await change(memo, [
      ...memo.definition.fields,
      { apiKey: 'owner', label: 'Owner', type: 'string', required: true },
    ]);
    expect(response.statusCode).toBe(202);
    const real = createContentPorts(database.current.db);
    let raced: number | undefined;
    // After the scan (no entries yet), an editor still on the old schema saves an entry without `owner`.
    const racing: SchemaContentPorts = {
      ...real,
      migration: {
        ...real.migration,
        run: async (step, context) => {
          const outcome = await real.migration.run(step, context);
          raced = (await create('memo', { title: 'written during the scan' })).statusCode;
          return outcome;
        },
      },
    };
    await runSchemaJobs(database.current.db, racing);
    expect(raced).toBe(201);
    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'failed',
      error: { invalidCount: 1 },
    });
    expect((await reload(memo.definition.id)).version).toBe(1);
  });

  it('concurrent activation of a required field and entry writes: no invalid committed row', async () => {
    const task = await model('task', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    await Promise.all(Array.from({ length: 30 }, (_, index) => create('task', { title: `seed ${index}` })));
    // Required with a default: existing entries are backfilled; entries written under the old schema while
    // the change runs (they cannot carry the field) must be backfilled by the activation's re-check.
    const response = await change(task, [
      ...task.definition.fields,
      { apiKey: 'due', label: 'Due', type: 'date', required: true, defaultValue: '2026-12-31' },
    ]);
    expect(response.statusCode).toBe(202);
    let stop = false;
    const statuses: number[] = [];
    const writers = Array.from({ length: 4 }, async () => {
      while (!stop) {
        statuses.push((await create('task', { title: 'racing' })).statusCode);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runContentSchemaJobs(database.current.db);
    stop = true;
    await Promise.all(writers);
    expect(statuses.filter((status) => status === 201).length).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);

    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });
    const dueId = fieldIdOf(await reload(task.definition.id), 'due');
    // Every committed head satisfies the active schema: none lacks the required field.
    const missing = await database.current.db
      .selectFrom('entry_heads')
      .select('entry_id')
      .where('model_id', '=', task.definition.id)
      .where(sql<boolean>`not (data ? ${dueId})`)
      .execute();
    expect(missing).toEqual([]);
    const total = await database.current.db
      .selectFrom('entry_heads')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('model_id', '=', task.definition.id)
      .executeTakeFirstOrThrow();
    expect(Number(total.count)).toBe(30 + statuses.filter((status) => status === 201).length);
  });

  it('a request pinned to the old schema cannot commit after an activation (409 SCHEMA_CHANGED)', async () => {
    const page = await model('page', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    const stale = await testApp.app.schemaRegistry.getSnapshot();
    expectStatus(
      await change(page, [...page.definition.fields, { apiKey: 'intro', label: 'Intro', type: 'text' }]),
      200,
    );
    const write = createEntry(
      {
        db: database.current.db,
        snapshot: stale,
        permissions: testApp.app.permissions,
        actor: testApp.principalFactory.system('test'),
        site: { id: PRIMARY_SITE_ID, key: 'default' },
        hooks: createContentHooks(),
      },
      'page',
      { data: { title: 'stale' } },
    );
    await expect(write).rejects.toMatchObject({ statusCode: 409, code: 'SCHEMA_CHANGED' });
  });

  it('making a field unique checks existing values and then guards new writes', async () => {
    const tag = await model('tag', [{ apiKey: 'label', label: 'Label', type: 'string' }]);
    const a = expectStatus(await create('tag', { label: 'dup' }), 201).json<EntryBody>();
    const b = expectStatus(await create('tag', { label: 'dup' }), 201).json<EntryBody>();
    const unique = (current: ModelBody) =>
      change(
        current,
        current.definition.fields.map((field) => ({ ...field, unique: true })),
      );

    const failing = await unique(tag);
    expect(failing.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    const failed = await changeStatus(failing.json<{ changeId: string }>().changeId);
    expect(failed.status).toBe('failed');
    expect(failed.error?.sampleEntryIds?.some((id) => [a.id, b.id].includes(id))).toBe(true);

    expectStatus(
      await admin.put(`/api/admin/content/tag/${b.id}`, { expectedVersion: 1, data: { label: 'other' } }),
      200,
    );
    const passing = await unique(await reload(tag.definition.id));
    await runContentSchemaJobs(database.current.db);
    expect(await changeStatus(passing.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });
    expect((await create('tag', { label: 'dup' })).statusCode).toBe(422);
    expect((await create('tag', { label: 'fresh' })).statusCode).toBe(201);
  });

  it('converts stored values when a type changes (integer → decimal)', async () => {
    const offer = await model('offer', [{ apiKey: 'price', label: 'Price', type: 'integer' }]);
    const entry = expectStatus(await create('offer', { price: 12 }), 201).json<EntryBody>();
    const response = await change(offer, [{ ...offer.definition.fields[0], type: 'decimal', settings: {} }]);
    expect(response.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });
    expect((await admin.get(`/api/admin/content/offer/${entry.id}`)).json<EntryBody>().data).toEqual({
      price: '12',
    });
  });
  it('unpublishing during a pending unique change releases the staged published claim', async () => {
    const badge = await model('badge', [{ apiKey: 'code', label: 'Code', type: 'string' }]);
    const first = expectStatus(await create('badge', { code: 'GOLD' }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/badge/${first.id}/publish`, {}), 200);
    // Live: GOLD; draft: SILVER.
    const published = (await admin.get(`/api/admin/content/badge/${first.id}`)).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/badge/${first.id}`, {
        expectedVersion: published.version,
        data: { code: 'SILVER' },
      }),
      200,
    );

    const response = await change(
      badge,
      badge.definition.fields.map((field) => ({ ...field, unique: true })),
    );
    expect(response.statusCode).toBe(202);
    const real = createContentPorts(database.current.db);
    // After the dry run staged its claims (GOLD published, SILVER draft), an editor unpublishes the entry.
    // Its draft is untouched, so the activation's re-check of changed heads never sees it.
    const racing: SchemaContentPorts = {
      ...real,
      migration: {
        ...real.migration,
        run: async (steps, context) => {
          const outcome = await real.migration.run(steps, context);
          expectStatus(await admin.post(`/api/admin/content/badge/${first.id}/unpublish`, {}), 200);
          return outcome;
        },
      },
    };
    await runSchemaJobs(database.current.db, racing);
    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });

    // Nothing holds GOLD any more: another entry can publish it, with no re-save of the first.
    const second = expectStatus(await create('badge', { code: 'GOLD' }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/badge/${second.id}/publish`, {}), 200);
    const owners = await database.current.db
      .selectFrom('unique_values')
      .select(['entry_id', 'state'])
      .where('field_id', '=', fieldIdOf(await reload(badge.definition.id), 'code'))
      .execute();
    expect(owners.filter((row) => row.entry_id === first.id).map((row) => row.state)).toEqual(['draft']);
  });

  it('a type change that makes unique values collide is refused before activation; live claims stay', async () => {
    const member = await model('member', [
      { apiKey: 'handle', label: 'Handle', type: 'string', unique: true },
    ]);
    expectStatus(await create('member', { handle: 'Ada@example.com' }), 201);
    expectStatus(await create('member', { handle: 'ada@example.com' }), 201);
    const registry = () =>
      database.current.db
        .selectFrom('unique_values')
        .select(['field_id', 'locale', 'state', 'value_hash', 'entry_id'])
        .where('model_id', '=', member.definition.id)
        .orderBy('value_hash')
        .execute();
    const before = await registry();
    expect(before).toHaveLength(2);

    // As an email, case no longer counts: the two handles become duplicates.
    const response = await change(
      member,
      member.definition.fields.map((field) => ({ ...field, type: 'email', settings: {}, editor: undefined })),
    );
    expect(response.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'failed',
      error: { step: expect.stringMatching(/^checkUnique:/) as unknown },
    });
    expect((await reload(member.definition.id)).version).toBe(member.version);
    // The live registry is exactly as it was, and still enforces the active (string) rule.
    expect(await registry()).toEqual(before);
    expect(
      (await create('member', { handle: 'Ada@example.com' })).json<{ error: { details: unknown } }>().error
        .details,
    ).toMatchObject({ issues: [{ path: '/handle', code: 'NOT_UNIQUE' }] });
  });

  it('a type change of a unique field that activates moves the registry to the new normalized form', async () => {
    const part = await model('part', [{ apiKey: 'sku', label: 'SKU', type: 'decimal', unique: true }]);
    expectStatus(await create('part', { sku: '12.50' }), 201);
    expectStatus(await create('part', { sku: '7' }), 201);
    const response = await change(
      part,
      part.definition.fields.map((field) => ({ ...field, type: 'string', settings: {}, editor: undefined })),
    );
    expect(response.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
      status: 'activated',
    });
    // As strings, "12.50" is taken but "12.5" is a different value (as a decimal it was the same one).
    expect((await create('part', { sku: '12.50' })).statusCode).toBe(422);
    expectStatus(await create('part', { sku: '12.5' }), 201);
    const staged = await database.current.db
      .selectFrom('unique_values')
      .select('field_id')
      .where('model_id', '=', part.definition.id)
      .where('field_id', '!=', fieldIdOf(await reload(part.definition.id), 'sku'))
      .execute();
    expect(staged).toEqual([]);
  });

  describe('a failed migration leaves the old schema and existing content usable (brief §10)', () => {
    type Delivered = { data: Record<string, unknown> };

    /** A published entry under `apiKey`, as delivery (REST and GraphQL) and the admin see it before the change. */
    const publishedProduct = async (apiKey: string, data: Record<string, unknown>) => {
      const entry = expectStatus(await create(apiKey, data), 201).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/${apiKey}/${entry.id}/publish`, {}), 200);
      return entry;
    };

    const expectUsableUnderOldSchema = async (
      current: ModelBody,
      before: ModelBody,
      entry: EntryBody,
      expected: { price: number; code: string; name: string },
    ) => {
      const apiKey = String(current.definition.apiKey);
      const routeKey = String(current.definition.pluralApiKey);
      // The old revision is still the active one.
      const active = await reload(current.definition.id);
      expect(active.version).toBe(before.version);
      expect(active.definition).toEqual(before.definition);

      const token = await createDeliveryToken(database.current.db, [{ modelId: current.definition.id }]);
      const delivered = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/${routeKey}/${entry.id}`,
          headers: { authorization: `Bearer ${token}` },
        }),
        200,
      ).json<Delivered>();
      expect(delivered.data).toMatchObject(expected);
      expect(delivered.data).not.toHaveProperty('origin');

      const viaGraphql = dataOf(
        await graphql<Record<string, Record<string, unknown>>>(
          testApp.app,
          `query ($id: ID!) { ${apiKey}(id: $id) { name code price } }`,
          { variables: { id: entry.id }, headers: { authorization: `Bearer ${token}` } },
        ),
      );
      expect(viaGraphql[apiKey]).toEqual(expected);

      // Admin reads see the stored values in the old form; admin writes and publishing still work.
      const draft = expectStatus(
        await admin.get(`/api/admin/content/${apiKey}/${entry.id}`),
        200,
      ).json<EntryBody>();
      expect(draft.data).toEqual(expected);
      expectStatus(
        await admin.put(`/api/admin/content/${apiKey}/${entry.id}`, {
          expectedVersion: draft.version,
          data: { ...expected, name: `${expected.name} (edited)`, price: expected.price + 1 },
        }),
        200,
      );
      expectStatus(await admin.post(`/api/admin/content/${apiKey}/${entry.id}/publish`, {}), 200);
      const republished = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/${routeKey}/${entry.id}`,
          headers: { authorization: `Bearer ${token}` },
        }),
        200,
      ).json<Delivered>();
      expect(republished.data).toMatchObject({
        name: `${expected.name} (edited)`,
        price: expected.price + 1,
      });
      // The old schema's rules apply to new entries: `code` is not unique there.
      expect((await create(apiKey, { name: 'Another', code: expected.code, price: 1 })).statusCode).toBe(201);
    };

    const productFields = [
      { apiKey: 'price', label: 'Price', type: 'integer' },
      { apiKey: 'code', label: 'Code', type: 'string' },
      { apiKey: 'name', label: 'Name', type: 'string' },
    ];

    type ChangeOptions = { convertPrice?: boolean; addRequired?: boolean };

    /**
     * `code` becomes unique (a uniqueness check) and, with `addRequired`, a required field with a default is
     * added (a backfill); with `convertPrice`, price becomes a decimal (a prerequisite that rewrites values).
     */
    const breakingChange = (
      current: ModelBody,
      { convertPrice = false, addRequired = true }: ChangeOptions = {},
    ) =>
      change(current, [
        ...current.definition.fields.map((field) =>
          field.apiKey === 'price' && convertPrice
            ? { ...field, type: 'decimal', settings: {} }
            : field.apiKey === 'code'
              ? { ...field, unique: true }
              : field,
        ),
        ...(addRequired
          ? [{ apiKey: 'origin', label: 'Origin', type: 'string', required: true, defaultValue: 'unknown' }]
          : []),
      ]);

    const failOnDuplicates = async (apiKey: string, options: ChangeOptions = {}) => {
      const product = await model(apiKey, productFields);
      const entry = await publishedProduct(apiKey, { price: 12, code: 'DUP', name: 'Lamp' });
      await publishedProduct(apiKey, { price: 30, code: 'DUP', name: 'Chair' });

      const before = await storageOf(product.definition.id);
      const response = await breakingChange(product, options);
      expect(response.statusCode).toBe(202);
      await runContentSchemaJobs(database.current.db);
      const failed = await changeStatus(response.json<{ changeId: string }>().changeId);
      expect(failed).toMatchObject({
        status: 'failed',
        error: { step: expect.stringMatching(/^checkUnique:/) as unknown },
      });
      expect(await storageOf(product.definition.id)).toEqual(before);

      await expectUsableUnderOldSchema(product, product, entry, { price: 12, code: 'DUP', name: 'Lamp' });
    };

    it('when its uniqueness check finds duplicates in real content', async () => {
      await failOnDuplicates('product');
    });

    // Conversions are dry-run in memory and written only by the activation (ADR 0002 pipeline): when a later
    // check fails, no converted value reaches storage, delivery or the admin.
    it('when it also converts a field type before the failing check (no converted value leaks)', async () => {
      await failOnDuplicates('pricedProduct', { convertPrice: true, addRequired: false });
    });

    /** Each kind of check, failing on content the same change also converts and backfills. */
    const failingChecks = [
      {
        kind: 'validateRequired',
        field: (field: ModelBody['definition']['fields'][number]) => field,
        extra: [{ apiKey: 'sku', label: 'SKU', type: 'string', required: true }],
      },
      {
        kind: 'checkUnique',
        field: (field: ModelBody['definition']['fields'][number]) =>
          field.apiKey === 'code' ? { ...field, unique: true } : field,
        extra: [],
      },
      {
        kind: 'validateValues',
        field: (field: ModelBody['definition']['fields'][number]) =>
          field.apiKey === 'name' ? { ...field, settings: { maxLength: 2 } } : field,
        extra: [],
      },
    ] as const;

    it.each(failingChecks)(
      'a failing $kind after a conversion and a backfill leaves storage byte-identical',
      async ({ kind, field, extra }) => {
        const apiKey = `${kind}Product`;
        const product = await model(apiKey, productFields);
        const entry = await publishedProduct(apiKey, { price: 12, code: 'DUP', name: 'Lamp' });
        await publishedProduct(apiKey, { price: 30, code: 'DUP', name: 'Chair' });
        // A draft ahead of its published version: both heads must stay as they are.
        const draft = (await admin.get(`/api/admin/content/${apiKey}/${entry.id}`)).json<EntryBody>();
        expectStatus(
          await admin.put(`/api/admin/content/${apiKey}/${entry.id}`, {
            expectedVersion: draft.version,
            data: { price: 13, code: 'DUP', name: 'Lamp' },
          }),
          200,
        );
        const before = await storageOf(product.definition.id);

        const response = await change(product, [
          ...product.definition.fields.map((candidate) =>
            candidate.apiKey === 'price' ? { ...candidate, type: 'decimal', settings: {} } : field(candidate),
          ),
          { apiKey: 'origin', label: 'Origin', type: 'string', required: true, defaultValue: 'unknown' },
          ...extra,
        ]);
        expect(response.statusCode).toBe(202);
        await runContentSchemaJobs(database.current.db);
        expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
          status: 'failed',
          error: { step: expect.stringMatching(new RegExp(`^${kind}:`)) as unknown },
        });

        expect(await storageOf(product.definition.id)).toEqual(before);
        expect((await reload(product.definition.id)).version).toBe(product.version);
        expect((await admin.get(`/api/admin/content/${apiKey}/${entry.id}`)).json<EntryBody>().data).toEqual({
          price: 13,
          code: 'DUP',
          name: 'Lamp',
        });
      },
    );

    it('a duplicate written after the dry run fails the activation and leaves storage byte-identical', async () => {
      const product = await model('racedProduct', productFields);
      await publishedProduct('racedProduct', { price: 12, code: 'A', name: 'Lamp' });
      await publishedProduct('racedProduct', { price: 30, code: 'B', name: 'Chair' });
      const before = await storageOf(product.definition.id);

      const response = await breakingChange(product, { convertPrice: true });
      expect(response.statusCode).toBe(202);
      const real = createContentPorts(database.current.db);
      let raced: EntryBody | undefined;
      // After the dry run passed (and staged its unique claims), an editor on the old schema reuses a code.
      const racing: SchemaContentPorts = {
        ...real,
        migration: {
          ...real.migration,
          run: async (steps, context) => {
            const outcome = await real.migration.run(steps, context);
            raced = expectStatus(
              await create('racedProduct', { price: 5, code: 'A', name: 'Copy' }),
              201,
            ).json<EntryBody>();
            return outcome;
          },
        },
      };
      await runSchemaJobs(database.current.db, racing);
      expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
        status: 'failed',
        error: {
          step: expect.stringMatching(/^checkUnique:/) as unknown,
          invalidCount: expect.any(Number) as unknown,
        },
      });

      const after = await storageOf(product.definition.id);
      expect({
        ...after,
        heads: after.heads.filter((head) => head.entry_id !== raced?.id),
        revisions: after.revisions.filter((revision) => revision.entry_id !== raced?.id),
      }).toEqual(before);
      // The racing entry was written under the old schema and kept as it was.
      expect(after.heads.filter((head) => head.entry_id === raced?.id).map((head) => head.data)).toEqual([
        {
          [fieldIdOf(product, 'price')]: 5,
          [fieldIdOf(product, 'code')]: 'A',
          [fieldIdOf(product, 'name')]: 'Copy',
        },
      ]);
    });

    it('a conversion, a backfill and a uniqueness check activate together with correct values', async () => {
      const product = await model('stockedProduct', productFields);
      const lamp = await publishedProduct('stockedProduct', { price: 12, code: 'L-1', name: 'Lamp' });
      const chair = await publishedProduct('stockedProduct', { price: 30, code: 'C-1', name: 'Chair' });

      const response = await breakingChange(product, { convertPrice: true });
      expect(response.statusCode).toBe(202);
      await runContentSchemaJobs(database.current.db);
      expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
        status: 'activated',
      });

      const current = await reload(product.definition.id);
      const [priceId, codeId, originId] = ['price', 'code', 'origin'].map((key) => fieldIdOf(current, key));
      const { heads, unique } = await storageOf(product.definition.id);
      // Draft and published heads alike hold the converted and backfilled values.
      expect(heads.map((head) => [head.entry_id, head.state, head.data[priceId as string]])).toEqual(
        expect.arrayContaining([
          [lamp.id, 'draft', '12'],
          [lamp.id, 'published', '12'],
          [chair.id, 'draft', '30'],
          [chair.id, 'published', '30'],
        ]),
      );
      expect(heads.every((head) => head.data[originId as string] === 'unknown')).toBe(true);
      expect(unique.filter((row) => row.field_id === codeId)).toHaveLength(4);

      const token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
      const delivered = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/stockedProducts/${lamp.id}`,
          headers: { authorization: `Bearer ${token}` },
        }),
        200,
      ).json<{ data: Record<string, unknown> }>();
      expect(delivered.data).toMatchObject({ price: '12', code: 'L-1', name: 'Lamp', origin: 'unknown' });
      expect((await create('stockedProduct', { price: '1', code: 'L-1', name: 'Copy' })).statusCode).toBe(
        422,
      );
      expect((await create('stockedProduct', { price: '1', code: 'N-1', name: 'New' })).statusCode).toBe(201);
    });

    it('concurrent writes during a conversion never commit an unconverted row', async () => {
      const product = await model('busyProduct', productFields);
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          create('busyProduct', { price: index, code: `seed-${index}`, name: 'seed' }),
        ),
      );
      const response = await breakingChange(product, { convertPrice: true });
      expect(response.statusCode).toBe(202);
      let stop = false;
      let counter = 0;
      const statuses: number[] = [];
      const writers = Array.from({ length: 4 }, async () => {
        while (!stop) {
          counter += 1;
          const data = { price: counter, code: `racing-${counter}`, name: 'racing' };
          statuses.push((await create('busyProduct', data)).statusCode);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await runContentSchemaJobs(database.current.db);
      stop = true;
      await Promise.all(writers);
      expect(statuses.filter((status) => status === 201).length).toBeGreaterThan(0);
      // 409: pinned to the old schema after the flip; 422: a write under the new schema sends an integer price.
      expect(statuses.every((status) => [201, 409, 422].includes(status))).toBe(true);
      expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
        status: 'activated',
      });

      const current = await reload(product.definition.id);
      const [priceId, originId] = ['price', 'origin'].map((key) => fieldIdOf(current, key));
      const { heads, unique } = await storageOf(product.definition.id);
      expect(heads.length).toBe(20 + statuses.filter((status) => status === 201).length);
      expect(heads.filter((head) => typeof head.data[priceId as string] !== 'string')).toEqual([]);
      expect(heads.filter((head) => head.data[originId as string] === undefined)).toEqual([]);
      expect(unique).toHaveLength(heads.length);
    });

    // Whole-entry validation of the conversion must see the new field's backfilled default (plan.ts orders
    // content steps by phase).
    it('a type conversion and a new required field with a default activate together', async () => {
      const offer = await model('bundleOffer', [
        { apiKey: 'price', label: 'Price', type: 'integer' },
        { apiKey: 'name', label: 'Name', type: 'string' },
      ]);
      const entry = expectStatus(await create('bundleOffer', { price: 1, name: 'a' }), 201).json<EntryBody>();
      const response = await change(offer, [
        { ...offer.definition.fields[0], type: 'decimal', settings: {} },
        offer.definition.fields[1],
        { apiKey: 'origin', label: 'Origin', type: 'string', required: true, defaultValue: 'unknown' },
      ]);
      expect(response.statusCode).toBe(202);
      await runContentSchemaJobs(database.current.db);
      expect(await changeStatus(response.json<{ changeId: string }>().changeId)).toMatchObject({
        status: 'activated',
      });
      expect((await admin.get(`/api/admin/content/bundleOffer/${entry.id}`)).json<EntryBody>().data).toEqual({
        price: '1',
        name: 'a',
        origin: 'unknown',
      });
    });

    it('when the prerequisite job crashes mid-run and runs out of attempts', async () => {
      const gadget = await model('gadget', productFields);
      const entry = await publishedProduct('gadget', { price: 7, code: 'G-1', name: 'Gadget' });
      const before = await storageOf(gadget.definition.id);

      const response = await breakingChange(gadget, { convertPrice: true });
      expect(response.statusCode).toBe(202);
      const { changeId } = response.json<{ changeId: string }>();
      // The worker dies inside the prerequisites after the first step did its work; no attempt is left.
      await database.current.db
        .updateTable('jobs')
        .set({ max_attempts: 1 })
        .where('type', '=', 'schema.change')
        .where('status', '=', 'pending')
        .execute();
      const real = createContentPorts(database.current.db);
      const crashing: SchemaContentPorts = {
        ...real,
        migration: {
          ...real.migration,
          run: async (steps, context) => {
            await real.migration.run(steps, context);
            throw new Error('worker crashed mid-migration');
          },
        },
      };
      await runSchemaJobs(database.current.db, crashing);
      expect(await changeStatus(changeId)).toMatchObject({
        status: 'failed',
        error: { reason: expect.stringMatching(/crashed mid-migration/) as unknown },
      });
      // The staged unique claims of `code` were released with the failure.
      expect(await storageOf(gadget.definition.id)).toEqual(before);

      await expectUsableUnderOldSchema(gadget, gadget, entry, { price: 7, code: 'G-1', name: 'Gadget' });
    });
  });
});

/** Conversions across an entry's locales are written by the activation too (ADR 0002 pipeline). */
describe('entry-level conversions and schema changes', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const save = async (id: string | null, locale: string, data: Record<string, unknown>) => {
    if (id === null) {
      return expectStatus(
        await admin.post('/api/admin/content/lamp', { locale, data }),
        201,
      ).json<EntryBody>();
    }
    const current = await admin.get(`/api/admin/content/lamp/${id}?locale=${locale}`);
    const expectedVersion = current.statusCode === 404 ? null : current.json<EntryBody>().version;
    return expectStatus(
      await admin.put(`/api/admin/content/lamp/${id}`, { locale, expectedVersion, data }),
      200,
    ).json<EntryBody>();
  };
  const headsOf = (modelId: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .selectAll()
      .where('model_id', '=', modelId)
      .orderBy('entry_id')
      .orderBy('locale')
      .orderBy('state')
      .execute();
  const unlocalize = (current: ModelBody, unique: boolean) =>
    admin.put(`/api/admin/models/${current.definition.id}`, {
      definition: {
        ...current.definition,
        localized: false,
        fields: current.definition.fields.map((field) =>
          field.apiKey === 'code' ? { ...field, unique } : field,
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
  const statusOf = async (response: { json: <T>() => T }) =>
    (
      await admin.get(`/api/admin/schema/changes/${response.json<{ changeId: string }>().changeId}`)
    ).json<ChangeBody>();

  it('a model that stops being localized keeps its locales when a later check fails, and drops them once it activates', async () => {
    const lamp = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'lamp',
      label: 'Lamp',
      localized: true,
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', localized: true },
        { apiKey: 'code', label: 'Code', type: 'string' },
      ],
    });
    const first = await save(null, 'en', { name: 'Lamp', code: 'DUP' });
    await save(first.id, 'fr', { name: 'Lampe' });
    expectStatus(
      await admin.post(`/api/admin/content/lamp/${first.id}/publish`, { locales: ['en', 'fr'] }),
      200,
    );
    await save(null, 'en', { name: 'Chair', code: 'DUP' });
    const before = await headsOf(lamp.definition.id);
    expect(before.filter((head) => head.locale === 'fr')).toHaveLength(2);

    const failing = await unlocalize(lamp, true);
    expect(failing.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await statusOf(failing)).toMatchObject({
      status: 'failed',
      error: { step: expect.stringMatching(/^checkUnique:/) as unknown },
    });
    expect(await headsOf(lamp.definition.id)).toEqual(before);
    expect(
      await database.current.db
        .selectFrom('unique_values')
        .selectAll()
        .where('model_id', '=', lamp.definition.id)
        .execute(),
    ).toEqual([]);

    const passing = await unlocalize(lamp, false);
    expect(passing.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    expect(await statusOf(passing)).toMatchObject({ status: 'activated' });
    const after = await headsOf(lamp.definition.id);
    expect(after.filter((head) => head.locale === 'fr')).toEqual([]);
    expect(after.filter((head) => head.entry_id === first.id).map((head) => head.state)).toEqual([
      'draft',
      'published',
    ]);
  });
});
