import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ChangeBody = {
  status: string;
  error: { step?: string; reason?: string; invalidCount?: number } | null;
};
type PlanPreview = {
  plan: {
    changes: Array<{ kind: string; destructive: boolean; dropsValues: boolean; prerequisites: string[] }>;
    summary: { destructive: boolean; supported: boolean };
  };
  impact: {
    steps: Array<{
      kind: string;
      affectedHeads: number;
      invalidHeads?: number;
      invalidEntries?: number;
      droppedEntries?: number;
    }>;
  };
};
type Delivered = { data: Record<string, unknown>; meta: { snapshot: number } };

/**
 * A type change Shapio cannot convert (Media → Number, Relation → Boolean, …): allowed after a destructive
 * acknowledgement, in one live change; every stored value is dropped with its media references, relation
 * edges and unique-registry rows. Required fields never end up with silent nulls. Old revisions keep the
 * values; delivery (also of old snapshots, read through the current schema) shows the field empty.
 */
describe('type changes that drop values', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let headers: Record<string, string>;
  let first: MediaAssetBody;
  let second: MediaAssetBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const token = await createRoleToken(database.current.db);
    headers = { authorization: `Bearer ${token}` };
    admin = schemaClient(testApp.app, token);
    first = await upload('first.png');
    second = await upload('second.png');
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const upload = async (filename: string) =>
    uploadAsset(testApp.app, headers, { file: await createPng(12, 12), filename, mimeType: 'image/png' });
  const model = (apiKey: string, fields: unknown[]) =>
    createDefinition(admin, { kind: 'collection', apiKey, label: apiKey, fields });
  const create = async (apiKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${apiKey}`, { data }), 201).json<EntryBody>();
  const publish = async (apiKey: string, id: string) =>
    expectStatus(await admin.post(`/api/admin/content/${apiKey}/${id}/publish`, {}), 200);
  const proposal = (current: ModelBody, fields: unknown[]) => ({
    definition: { ...current.definition, fields },
    expectedVersion: current.version,
  });
  const change = (current: ModelBody, fields: unknown[], acknowledgeDestructive = true) =>
    admin.put(`/api/admin/models/${current.definition.id}`, {
      ...proposal(current, fields),
      acknowledgeBreaking: true,
      acknowledgeDestructive,
    });
  const preview = async (current: ModelBody, fields: unknown[]) =>
    expectStatus(
      await admin.post(`/api/admin/models/${current.definition.id}/plan`, proposal(current, fields)),
      200,
    ).json<PlanPreview>();
  const shipped = async (response: { statusCode: number; json: <T>() => T }) => {
    expect(response.statusCode).toBe(202);
    await runContentSchemaJobs(database.current.db);
    const { changeId } = response.json<{ changeId: string }>();
    return (await admin.get(`/api/admin/schema/changes/${changeId}`)).json<ChangeBody>();
  };
  const retype = (current: ModelBody, apiKey: string, update: Record<string, unknown>) =>
    current.definition.fields.map((field) =>
      field.apiKey === apiKey ? { ...field, editor: undefined, settings: {}, ...update } : field,
    );
  const headsOf = (modelId: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .select(['entry_id', 'state', 'data'])
      .where('model_id', '=', modelId)
      .execute();

  it('Media → Number: destructive, acknowledged, values, references and old snapshots handled', async () => {
    const product = await model('product', [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'gallery', label: 'Gallery', type: 'media', settings: { multiple: true } },
    ]);
    const galleryId = fieldIdOf(product, 'gallery');
    const one = await create('product', { title: 'One', gallery: [first.id] });
    const two = await create('product', { title: 'Two', gallery: [second.id, first.id] });
    await create('product', { title: 'Empty' });
    await publish('product', one.id);
    await publish('product', two.id);
    const token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
    const deliver = (url: string) =>
      testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    const before = expectStatus(await deliver(`/api/content/products/${one.id}`), 200).json<Delivered>();
    expect(before.data.gallery).toHaveLength(1);

    const fields = retype(product, 'gallery', { type: 'number' });
    const { plan, impact } = await preview(product, fields);
    expect(plan.summary).toMatchObject({ destructive: true, supported: true });
    expect(plan.changes.find((candidate) => candidate.kind === 'field.type')).toMatchObject({
      destructive: true,
      dropsValues: true,
      prerequisites: ['convert', 'validateValues'],
    });
    expect(impact.steps.find((step) => step.kind === 'convert')).toMatchObject({ droppedEntries: 2 });

    expect((await change(product, fields, false)).json()).toMatchObject({
      error: { code: 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED' },
    });
    expect(await shipped(await change(product, fields))).toMatchObject({ status: 'activated' });

    for (const head of await headsOf(product.definition.id)) {
      expect(head.data).not.toHaveProperty(galleryId);
    }
    expect((await admin.get(`/api/admin/content/product/${two.id}`)).json<EntryBody>().data).toEqual({
      title: 'Two',
      gallery: null,
    });
    const references = await database.current.db
      .selectFrom('media_references')
      .select('asset_id')
      .where('entry_id', 'in', [one.id, two.id])
      .execute();
    expect(references).toEqual([]);
    // Old revisions still hold the asset IDs (history is exact); a schema rollback cannot restore them.
    const revisions = await database.current.db
      .selectFrom('content_revisions')
      .select(['data', 'reason'])
      .where('entry_id', '=', one.id)
      .execute();
    expect(revisions.some((revision) => revision.reason !== 'conversion' && galleryId in revision.data)).toBe(
      true,
    );
    expect(
      revisions
        .filter((revision) => revision.reason === 'conversion')
        .every((revision) => !(galleryId in revision.data)),
    ).toBe(true);

    const after = expectStatus(await deliver(`/api/content/products/${one.id}`), 200).json<Delivered>();
    expect(after.data.gallery).toBeNull();
    expect(after.meta.snapshot).toBeGreaterThan(before.meta.snapshot);
    const past = expectStatus(
      await deliver(`/api/content/products/${one.id}?snapshot=${before.meta.snapshot}`),
      200,
    ).json<Delivered>();
    expect(past.data).toMatchObject({ title: 'One', gallery: null });

    // Nothing references the assets any more: they can be deleted.
    expect(
      (await testApp.app.inject({ method: 'DELETE', url: `/api/admin/media/assets/${second.id}`, headers }))
        .statusCode,
    ).toBe(204);
  });

  describe('a multi-value enum (stored as a list of strings)', () => {
    const VALUES = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    const tagged = async (apiKey: string) => {
      const definition = await model(apiKey, [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'tags', label: 'Tags', type: 'enum', settings: { multiple: true, values: VALUES } },
      ]);
      const one = await create(apiKey, { title: 'One', tags: ['a', 'b'] });
      const two = await create(apiKey, { title: 'Two', tags: ['b'] });
      await create(apiKey, { title: 'Empty' });
      await publish(apiKey, one.id);
      await publish(apiKey, two.id);
      const token = await createDeliveryToken(database.current.db, [{ modelId: definition.definition.id }]);
      const deliver = async (url: string) =>
        expectStatus(
          await testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
          200,
        ).json<Delivered>();
      return { definition, one, two, deliver };
    };

    it('→ short text drops the values (destructive, counted), never just hides them', async () => {
      const { definition, one, deliver } = await tagged('note');
      const tagsId = fieldIdOf(definition, 'tags');
      const before = await deliver(`/api/content/notes/${one.id}`);
      expect(before.data.tags).toEqual(['a', 'b']);

      const fields = retype(definition, 'tags', { type: 'string' });
      const { plan, impact } = await preview(definition, fields);
      expect(plan.summary).toMatchObject({ destructive: true, supported: true });
      expect(plan.changes.find((candidate) => candidate.kind === 'field.type')).toMatchObject({
        destructive: true,
        dropsValues: true,
        prerequisites: ['convert', 'validateValues'],
      });
      expect(impact.steps.find((step) => step.kind === 'convert')).toMatchObject({ droppedEntries: 2 });
      expect((await change(definition, fields, false)).json()).toMatchObject({
        error: { code: 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED' },
      });
      expect(await shipped(await change(definition, fields))).toMatchObject({ status: 'activated' });

      // Gone from storage, not left behind under a type that can't read it.
      for (const head of await headsOf(definition.definition.id)) {
        expect(head.data).not.toHaveProperty(tagsId);
      }
      expect((await deliver(`/api/content/notes/${one.id}`)).data.tags).toBeNull();
      const past = await deliver(`/api/content/notes/${one.id}?snapshot=${before.meta.snapshot}`);
      expect(past.data).toMatchObject({ title: 'One', tags: null });

      // Back to a multi-value enum: live entries stay empty (the heads hold nothing). Old snapshots read
      // their revisions through the current schema, so one from before the drop shows the lists again: the
      // old revisions keep them, as for every dropped type change.
      const current = (await admin.get(`/api/admin/models/${definition.definition.id}`)).json<ModelBody>();
      const reverted = retype(current, 'tags', {
        type: 'enum',
        settings: { multiple: true, values: VALUES },
      });
      expect(await shipped(await change(current, reverted))).toMatchObject({ status: 'activated' });
      expect((await deliver(`/api/content/notes/${one.id}`)).data.tags).toBeNull();
      const pastAgain = await deliver(`/api/content/notes/${one.id}?snapshot=${before.meta.snapshot}`);
      expect(pastAgain.data.tags).toEqual(['a', 'b']);
    });

    it('→ rich text is a drop the job carries out, not a conversion that fails', async () => {
      const { definition, one, deliver } = await tagged('memo');
      const fields = retype(definition, 'tags', { type: 'richtext', settings: { formatVersion: 1 } });
      const { plan } = await preview(definition, fields);
      expect(plan.changes.find((candidate) => candidate.kind === 'field.type')).toMatchObject({
        dropsValues: true,
      });
      expect(await shipped(await change(definition, fields))).toMatchObject({ status: 'activated' });
      expect((await deliver(`/api/content/memos/${one.id}`)).data.tags).toBeNull();
    });

    it('text → multi-value enum makes each value a one-value list, checked against the choices', async () => {
      const mood = await model('mood', [{ apiKey: 'tone', label: 'Tone', type: 'text' }]);
      const kept = await create('mood', { tone: 'a' });
      const fields = retype(mood, 'tone', { type: 'enum', settings: { multiple: true, values: VALUES } });
      const { plan } = await preview(mood, fields);
      expect(plan.changes.find((candidate) => candidate.kind === 'field.type')).toMatchObject({
        destructive: false,
        dropsValues: false,
        prerequisites: ['convert', 'validateValues'],
      });
      expect(await shipped(await change(mood, fields, false))).toMatchObject({ status: 'activated' });
      expect((await admin.get(`/api/admin/content/mood/${kept.id}`)).json<EntryBody>().data).toEqual({
        tone: ['a'],
      });

      // A value that isn't one of the choices fails the check, with the count, instead of shipping.
      const current = (await admin.get(`/api/admin/models/${mood.definition.id}`)).json<ModelBody>();
      const back = retype(current, 'tone', { type: 'text' });
      expect(await shipped(await change(current, back))).toMatchObject({ status: 'activated' });
      const text = (await admin.get(`/api/admin/models/${mood.definition.id}`)).json<ModelBody>();
      await create('mood', { tone: 'loud' });
      const again = retype(text, 'tone', { type: 'enum', settings: { multiple: true, values: VALUES } });
      const failed = await shipped(await change(text, again, false));
      expect(failed).toMatchObject({ status: 'failed', error: { invalidCount: 1 } });
      expect(failed.error?.step).toMatch(/^validateValues:/);
    });
  });

  const save = async (apiKey: string, entry: EntryBody, data: Record<string, unknown>) =>
    expectStatus(
      await admin.put(`/api/admin/content/${apiKey}/${entry.id}`, { expectedVersion: entry.version, data }),
      200,
    ).json<EntryBody>();
  const firstRevisionOf = async (apiKey: string, id: string) => {
    const { items } = (await admin.get(`/api/admin/content/${apiKey}/${id}/revisions`)).json<{
      items: Array<{ id: string; reason: string }>;
    }>();
    return items.find((item) => item.reason === 'create')?.id ?? '';
  };
  const lastSnapshot = async () =>
    Number(
      (await database.current.db.selectFrom('publication_state').select('last_seq').executeTakeFirstOrThrow())
        .last_seq,
    );

  it('a revision saved before a type change restores as its view shows it, values of the old type empty', async () => {
    const jot = await model('jot', [
      { apiKey: 't', label: 'T', type: 'string' },
      { apiKey: 'int', label: 'Int', type: 'integer' },
      { apiKey: 'm', label: 'M', type: 'media' },
    ]);
    const created = await create('jot', { t: 'v1', int: 7, m: first.id });
    await publish('jot', created.id);
    const at = await lastSnapshot();
    await save('jot', created, { t: 'v2' });
    await publish('jot', created.id);
    const revisionId = await firstRevisionOf('jot', created.id);

    const retyped = retype(jot, 'int', { type: 'string' }).map((field) =>
      field.apiKey === 'm' ? { ...field, editor: undefined, settings: {}, type: 'number' } : field,
    );
    expect(await shipped(await change(jot, retyped))).toMatchObject({ status: 'activated' });
    const view = (await admin.get(`/api/admin/content/jot/${created.id}/revisions/${revisionId}`)).json<{
      data: Record<string, unknown>;
    }>();
    expect(view.data).toEqual({ t: 'v1', int: null, m: null });

    const current = (await admin.get(`/api/admin/content/jot/${created.id}`)).json<EntryBody>();
    const restored = expectStatus(
      await admin.post(`/api/admin/content/jot/${created.id}/revisions/${revisionId}/restore`, {
        expectedVersion: current.version,
      }),
      200,
    ).json<EntryBody>();
    expect(restored.data).toEqual({ t: 'v1', int: null, m: null });

    // Restoring the snapshot served before the change: restorable, published with the old-type values empty.
    const restore = expectStatus(await admin.post(`/api/admin/snapshots/${at}/restore`, {}), 201).json<{
      id: string;
      version: number;
    }>();
    const review = expectStatus(await admin.get(`/api/admin/change-sets/${restore.id}/review`), 200).json<{
      notRestorable: unknown[];
      entries: Array<{
        entryId: string;
        issues: unknown[];
        fields: Array<{ apiKey: string; after: unknown }>;
      }>;
    }>();
    expect(review.notRestorable).toEqual([]);
    // The live value converted to "7" goes back to empty, as the snapshot showed it.
    const reviewed = review.entries.find((item) => item.entryId === created.id);
    expect(reviewed?.issues).toEqual([]);
    expect(reviewed?.fields.map((field) => [field.apiKey, field.after])).toEqual([
      ['t', 'v1'],
      ['int', null],
    ]);
    expectStatus(
      await admin.post(`/api/admin/change-sets/${restore.id}/ship`, {
        expectedVersion: restore.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      }),
      200,
    );
    const token = await createDeliveryToken(database.current.db, [{ modelId: jot.definition.id }]);
    const delivered = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/jots/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<Delivered>();
    expect(delivered.data).toMatchObject({ t: 'v1', int: null, m: null });
  });

  it('restoring a revision whose required value had the old type is refused, naming the type change', async () => {
    const card = await model('card', [
      { apiKey: 't', label: 'T', type: 'string' },
      { apiKey: 'n', label: 'N', type: 'integer', required: true },
    ]);
    const created = await create('card', { t: 'v1', n: 5 });
    await save('card', created, { t: 'v2', n: 5 });
    const revisionId = await firstRevisionOf('card', created.id);
    expect(await shipped(await change(card, retype(card, 'n', { type: 'string' })))).toMatchObject({
      status: 'activated',
    });
    const current = (await admin.get(`/api/admin/content/card/${created.id}`)).json<EntryBody>();
    expect(current.data).toEqual({ t: 'v2', n: '5' });

    const refused = await admin.post(
      `/api/admin/content/card/${created.id}/revisions/${revisionId}/restore`,
      {
        expectedVersion: current.version,
      },
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      error: {
        code: 'CONTENT_INVALID',
        details: {
          issues: [
            {
              path: '/n',
              code: 'REQUIRED',
              message: expect.stringContaining("before the field's type changed to string") as unknown,
            },
          ],
        },
      },
    });
  });

  it('a required field: refused with the count unless it has a default, which is backfilled', async () => {
    const poster = await model('poster', [
      { apiKey: 'title', label: 'Title', type: 'string' },
      { apiKey: 'cover', label: 'Cover', type: 'media', required: true },
    ]);
    const entry = await create('poster', { title: 'P', cover: first.id });
    await publish('poster', entry.id);

    const required = retype(poster, 'cover', { type: 'integer' });
    const { impact } = await preview(poster, required);
    // One entry, published: two versions (draft and published) fail, and the review says both numbers.
    expect(impact.steps.find((step) => step.kind === 'validateRequired')).toMatchObject({
      invalidHeads: 2,
      invalidEntries: 1,
    });
    expect(await shipped(await change(poster, required))).toMatchObject({
      status: 'failed',
      error: {
        step: expect.stringMatching(/^validateRequired:/) as unknown,
        reason: expect.stringMatching(/required field/) as unknown,
        invalidCount: 2,
      },
    });
    expect(
      (await headsOf(poster.definition.id)).every((head) => fieldIdOf(poster, 'cover') in head.data),
    ).toBe(true);

    const withDefault = retype(poster, 'cover', { type: 'integer', defaultValue: 7 });
    expect(await shipped(await change(poster, withDefault))).toMatchObject({ status: 'activated' });
    expect((await admin.get(`/api/admin/content/poster/${entry.id}`)).json<EntryBody>().data).toEqual({
      title: 'P',
      cover: 7,
    });
  });

  it('a media field that stops being localized: references follow the kept value', async () => {
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const kept = await upload('kept.png');
    const dropped = await upload('dropped.png');
    const lamp = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'lamp',
      label: 'Lamp',
      localized: true,
      fields: [{ apiKey: 'photo', label: 'Photo', type: 'media', localized: true }],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/lamp', { locale: 'en', data: { photo: kept.id } }),
      201,
    ).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/lamp/${entry.id}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { photo: dropped.id },
      }),
      200,
    );
    const references = () =>
      database.current.db
        .selectFrom('media_references')
        .select(['asset_id', 'locale'])
        .where('entry_id', '=', entry.id)
        .orderBy('locale')
        .execute();
    expect(await references()).toEqual([
      { asset_id: kept.id, locale: 'en' },
      { asset_id: dropped.id, locale: 'fr' },
    ]);

    const shared = lamp.definition.fields.map((field) => ({ ...field, localized: false }));
    expect(await shipped(await change(lamp, shared))).toMatchObject({ status: 'activated' });
    expect(await references()).toEqual([
      { asset_id: kept.id, locale: 'en' },
      { asset_id: kept.id, locale: 'fr' },
    ]);
    expect(
      (await testApp.app.inject({ method: 'DELETE', url: `/api/admin/media/assets/${dropped.id}`, headers }))
        .statusCode,
    ).toBe(204);
  });

  it('a unique field leaves no registry rows; a relation leaves no edges', async () => {
    const author = await model('writer', [{ apiKey: 'name', label: 'Name', type: 'string' }]);
    const target = await create('writer', { name: 'Ada' });
    const tag = await model('label', [
      { apiKey: 'code', label: 'Code', type: 'string', unique: true },
      {
        apiKey: 'writer',
        label: 'Writer',
        type: 'relation',
        settings: { target: author.definition.id, cardinality: 'one' },
      },
    ]);
    const a = await create('label', { code: 'a', writer: target.id });
    await create('label', { code: 'b', writer: target.id });
    await publish('label', a.id);

    const uniqueToNumber = retype(tag, 'code', { type: 'number' });
    expect(await shipped(await change(tag, uniqueToNumber))).toMatchObject({ status: 'activated' });
    const registry = await database.current.db
      .selectFrom('unique_values')
      .select('entry_id')
      .where('model_id', '=', tag.definition.id)
      .execute();
    expect(registry).toEqual([]);

    const current = (await admin.get(`/api/admin/models/${tag.definition.id}`)).json<ModelBody>();
    expect(
      await shipped(await change(current, retype(current, 'writer', { type: 'boolean' }))),
    ).toMatchObject({
      status: 'activated',
    });
    const edges = await database.current.db
      .selectFrom('relation_edges')
      .select('source_entry_id')
      .where('target_entry_id', '=', target.id)
      .execute();
    expect(edges).toEqual([]);
  });
});
