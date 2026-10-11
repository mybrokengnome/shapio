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
