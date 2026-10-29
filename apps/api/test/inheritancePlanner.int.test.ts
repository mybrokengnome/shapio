import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldIndexName } from '../src/content/compiler/expressions.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ChangeBody = {
  status: string;
  error: { step?: string; reason?: string } | null;
  outcome: { requiredGaps: Array<{ fieldApiKey?: string; versions: number; entries: number }> } | null;
};
type PreviewBody = {
  plan: { affectedModelIds: string[]; changes: Array<{ kind: string; category: string; breaking: boolean }> };
  impact: { affectedHeads: number; steps: Array<{ kind: string; affectedHeads: number }> };
};

/**
 * Schema changes to a family of types (plan polymorphic-types D10, decisions 5 and 6): a parent change is
 * planned and applied for every member, a re-parent is a breaking contract change that strips the values
 * of lost fields, a parent with children cannot be deleted, and a scope change moves a family from its root.
 */
describe('model inheritance: planner', () => {
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

  const reload = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/models/${id}`), 200).json<ModelBody>();
  const entry = async (apiKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${apiKey}`, { data }), 201).json<EntryBody>();
  const headData = async (entryId: string) =>
    (
      await database.current.db
        .selectFrom('entry_heads')
        .select('data')
        .where('entry_id', '=', entryId)
        .executeTakeFirstOrThrow()
    ).data as Record<string, unknown>;
  const changeStatus = async (changeId: string) =>
    expectStatus(await admin.get(`/api/admin/schema/changes/${changeId}`), 200).json<ChangeBody>();
  /** Applies a change that has prerequisites and runs them; returns the change's final state. */
  const applyAndRun = async (model: ModelBody, definition: Record<string, unknown>) => {
    const response = expectStatus(
      await admin.put(`/api/admin/models/${model.definition.id}`, {
        definition,
        expectedVersion: model.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      }),
      202,
    );
    await runContentSchemaJobs(database.current.db);
    return changeStatus(response.json<{ changeId: string }>().changeId);
  };
  const family = async (suffix: string) => {
    const parent = await createDefinition(admin, {
      kind: 'collection',
      apiKey: `item${suffix}`,
      pluralApiKey: `items${suffix}`,
      label: 'Item',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const child = await createDefinition(admin, {
      kind: 'collection',
      apiKey: `book${suffix}`,
      pluralApiKey: `books${suffix}`,
      label: 'Book',
      extends: parent.definition.id,
      fields: [{ apiKey: 'pages', label: 'Pages', type: 'integer' }],
    });
    return { parent, child };
  };

  it('a required field with a default on a parent backfills and indexes every member', async () => {
    const { parent, child } = await family('A');
    await entry('itemA', { name: 'Mug' });
    const book = await entry('bookA', { name: 'Ebook', pages: 10 });
    const definition = {
      ...parent.definition,
      fields: [
        ...parent.definition.fields,
        {
          apiKey: 'brand',
          label: 'Brand',
          type: 'string',
          required: true,
          defaultValue: 'acme',
          filterable: true,
        },
      ],
    };
    const preview = expectStatus(
      await admin.post(`/api/admin/models/${parent.definition.id}/plan`, {
        definition,
        expectedVersion: parent.version,
      }),
      200,
    ).json<PreviewBody>();
    expect(preview.plan.affectedModelIds).toEqual([parent.definition.id, child.definition.id]);
    // One draft head each: the child's entry counts.
    expect(preview.impact.affectedHeads).toBe(2);
    // Each member's index is built over that member's heads only.
    expect(
      preview.impact.steps.filter((step) => step.kind === 'buildIndex').map((step) => step.affectedHeads),
    ).toEqual([1, 1]);

    expect(await applyAndRun(parent, definition)).toMatchObject({ status: 'activated' });
    const brandId = fieldIdOf(await reload(parent.definition.id), 'brand');
    expect(await headData(book.id)).toMatchObject({ [brandId]: 'acme' });
    for (const modelId of [parent.definition.id, child.definition.id]) {
      const name = fieldIndexName({ modelId, fieldId: brandId, type: 'string', localized: false });
      expect(await getIndexState(database.current.db, name)).toBe('valid');
    }
  });

  it('moving a type under another parent is a breaking contract change that strips lost values', async () => {
    const { parent, child } = await family('B');
    const other = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'gadgetB',
      pluralApiKey: 'gadgetsB',
      label: 'Gadget',
      fields: [{ apiKey: 'serial', label: 'Serial', type: 'string' }],
    });
    const book = await entry('bookB', { name: 'Ebook', pages: 10 });
    const moved = { ...child.definition, extends: other.definition.id };
    const refused = await admin.put(`/api/admin/models/${child.definition.id}`, {
      definition: moved,
      expectedVersion: child.version,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED' } });
    const preview = expectStatus(
      await admin.post(`/api/admin/models/${child.definition.id}/plan`, {
        definition: moved,
        expectedVersion: child.version,
      }),
      200,
    ).json<PreviewBody>();
    expect(preview.plan.changes).toMatchObject([
      { kind: 'model.extends', category: 'contract', breaking: true },
    ]);

    expect(await applyAndRun(child, moved)).toMatchObject({ status: 'activated' });
    const data = await headData(book.id);
    expect(data).not.toHaveProperty(fieldIdOf(parent, 'name'));
    expect(data).toMatchObject({ [fieldIdOf(child, 'pages')]: 10 });
  });

  it('moving a type under a parent with a required field it lacks counts that field, not a clear', async () => {
    const { child } = await family('F');
    await entry('bookF', { name: 'Ebook', pages: 10 });
    const post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'postF',
      pluralApiKey: 'postsF',
      label: 'Post',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    // It goes live (ADR 0002 amendment 2026-10-29); the entry is counted for the field it now lacks.
    const outcome = await applyAndRun(child, { ...child.definition, extends: post.definition.id });
    expect(outcome).toMatchObject({
      status: 'activated',
      error: null,
      outcome: { requiredGaps: [{ fieldApiKey: 'title', versions: 1, entries: 1 }] },
    });
  });

  it('a parent with children cannot be deleted; its child can', async () => {
    const { parent, child } = await family('C');
    const refused = await admin.delete(
      `/api/admin/models/${parent.definition.id}?expectedVersion=${parent.version}&acknowledgeBreaking=true`,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      error: { code: 'HAS_CHILDREN', details: { children: [{ id: child.definition.id, apiKey: 'bookC' }] } },
    });
    expectStatus(
      await admin.delete(
        `/api/admin/models/${child.definition.id}?expectedVersion=${child.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
    expectStatus(
      await admin.delete(
        `/api/admin/models/${parent.definition.id}?expectedVersion=${parent.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
  });

  it('a parent’s localization or drafts flag cannot change alone: the message names its kinds', async () => {
    const { parent } = await family('E');
    const response = await admin.put(`/api/admin/models/${parent.definition.id}`, {
      definition: { ...parent.definition, draftAndPublish: false },
      expectedVersion: parent.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: 'FAMILY_FLAG_CHANGE',
        details: { flags: ['draftAndPublish'], children: [{ apiKey: 'bookE' }] },
      },
    });
    const { message } = response.json<{ error: { message: string } }>().error;
    expect(message).toContain('(bookE)');
    expect(message).toContain('together in one change set');
  });

  it('a scope change moves the family from its root and is refused on a child', async () => {
    const { parent, child } = await family('D');
    const refused = await admin.put(`/api/admin/models/${child.definition.id}/scope`, {
      scope: 'network',
      version: child.version,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'SCOPE_OF_CHILD_TYPE' } });
    const before = (await testApp.app.schemaRegistry.getSnapshot()).scopeOf(child.definition.id);
    expectStatus(
      await admin.put(`/api/admin/models/${parent.definition.id}/scope`, {
        scope: 'network',
        version: parent.version,
      }),
      200,
    );
    const snapshot = await testApp.app.schemaRegistry.getSnapshot();
    expect(before).not.toBeNull();
    expect(snapshot.scopeOf(parent.definition.id)).toBeNull();
    expect(snapshot.scopeOf(child.definition.id)).toBeNull();
  });
});
