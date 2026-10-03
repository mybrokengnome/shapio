import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldIndexName } from '../src/content/compiler/expressions.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import { NO_CONTENT_PORTS, type SchemaContentPorts } from '../src/schema/planner/contentPorts.js';
import type { ContentStep } from '../src/schema/planner/steps.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason } from './helpers/dialect.js';
import {
  createRoleToken,
  pageDefinition,
  runSchemaJobs,
  schemaClient,
  type SchemaClient,
} from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ModelBody = {
  definition: {
    id: string;
    fields: Array<Record<string, unknown> & { id: string; apiKey: string }>;
  } & Record<string, unknown>;
  version: number;
  pendingChange: { id: string; status: string } | null;
};

/** Content ports that report invalid content for one kind of step, in the dry run or at the final re-check. */
const failingPorts = (kind: ContentStep['kind'], phase: 'run' | 'apply'): SchemaContentPorts => ({
  ...NO_CONTENT_PORTS,
  migration: {
    ...NO_CONTENT_PORTS.migration,
    run: async (steps) =>
      phase === 'run' && steps.some((step) => step.kind === kind)
        ? { ok: false, reason: 'entries are missing a value', invalidCount: 2, sampleEntryIds: ['e1', 'e2'] }
        : { ok: true, watermark: 41 },
    apply: async (steps, watermark) =>
      phase === 'apply' && steps.some((step) => step.kind === kind) && watermark === 41
        ? { ok: false, reason: 'a write after the watermark left a value missing', invalidCount: 1 }
        : { ok: true },
  },
});

describe('planned schema changes (prerequisites)', () => {
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

  const createModel = async (apiKey: string, fields?: unknown[]) => {
    const response = await admin.post('/api/admin/models', {
      definition: pageDefinition({ apiKey, label: apiKey, ...(fields ? { fields } : {}) }),
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ definitionId: string }>().definitionId;
  };
  const getModel = async (id: string) => (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
  const addRequiredField = (model: ModelBody, apiKey = 'summary') => ({
    definition: {
      ...model.definition,
      fields: [...model.definition.fields, { apiKey, label: apiKey, type: 'text', required: true }],
    },
    expectedVersion: model.version,
  });

  it('a required field on an existing model runs prerequisites, then activates', async () => {
    const id = await createModel('guide');
    const model = await getModel(id);
    const response = await admin.put(`/api/admin/models/${id}`, addRequiredField(model));
    expect(response.statusCode, response.body).toBe(202);
    const { changeId } = response.json<{ changeId: string }>();

    const during = await getModel(id);
    expect(during.version).toBe(1);
    expect(during.pendingChange).toMatchObject({ id: changeId, status: 'pending' });
    const listed = (await admin.get('/api/admin/models')).json<{ items: ModelBody[] }>().items;
    expect(listed.find((item) => item.definition.id === id)?.pendingChange).toEqual({
      id: changeId,
      status: 'pending',
    });
    const blocked = await admin.put(`/api/admin/models/${id}`, {
      definition: { ...model.definition, label: 'x' },
      expectedVersion: 1,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'SCHEMA_CHANGE_IN_PROGRESS' } });

    await runSchemaJobs(database.current.db);
    expect((await admin.get(`/api/admin/schema/changes/${changeId}`)).json()).toMatchObject({
      status: 'activated',
    });
    const after = await getModel(id);
    expect(after.version).toBe(2);
    expect(after.pendingChange).toBeNull();
    const listedAfter = (await admin.get('/api/admin/models')).json<{ items: ModelBody[] }>().items;
    expect(listedAfter.find((item) => item.definition.id === id)?.pendingChange).toBeNull();
    expect(after.definition.fields.map((field) => field.apiKey)).toEqual(['title', 'summary']);
  });

  it('a failing prerequisite keeps the previous revision active and records why', async () => {
    const id = await createModel('recipe');
    const model = await getModel(id);
    const response = await admin.put(`/api/admin/models/${id}`, addRequiredField(model));
    expect(response.statusCode).toBe(202);
    const { changeId } = response.json<{ changeId: string }>();

    await runSchemaJobs(database.current.db, failingPorts('validateRequired', 'run'));

    const change = (await admin.get(`/api/admin/schema/changes/${changeId}`)).json<unknown>();
    expect(change).toMatchObject({
      status: 'failed',
      error: { reason: 'entries are missing a value', invalidCount: 2, sampleEntryIds: ['e1', 'e2'] },
    });
    const after = await getModel(id);
    expect(after).toMatchObject({ version: 1, pendingChange: null });
    expect(after.definition).toEqual(model.definition);
    // The model is still usable and editable: the next change goes through.
    const next = await admin.put(`/api/admin/models/${id}`, {
      definition: { ...model.definition, label: 'Recipes' },
      expectedVersion: 1,
    });
    expect(next.statusCode).toBe(200);
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', id)
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((row) => row.action)).toEqual([
      'schema.activate',
      'schema.change.request',
      'schema.activate',
    ]);
  });

  it('a failing watermark re-check at activation also keeps the previous revision', async () => {
    const id = await createModel('venue');
    const model = await getModel(id);
    const { changeId } = (await admin.put(`/api/admin/models/${id}`, addRequiredField(model))).json<{
      changeId: string;
    }>();
    await runSchemaJobs(database.current.db, failingPorts('validateRequired', 'apply'));
    expect((await admin.get(`/api/admin/schema/changes/${changeId}`)).json()).toMatchObject({
      status: 'failed',
      error: { reason: 'a write after the watermark left a value missing' },
    });
    expect((await getModel(id)).version).toBe(1);
  });

  it('a required field with a default plans a backfill instead of a validation', async () => {
    const id = await createModel('lesson');
    const model = await getModel(id);
    const proposal = {
      definition: {
        ...model.definition,
        fields: [
          ...model.definition.fields,
          { apiKey: 'level', label: 'Level', type: 'string', required: true, defaultValue: 'beginner' },
        ],
      },
      expectedVersion: 1,
    };
    const preview = await admin.post(`/api/admin/models/${id}/plan`, proposal);
    expect(preview.json()).toMatchObject({
      plan: {
        prerequisites: [{ kind: 'backfill', value: 'beginner', locations: [{ modelId: id, path: [] }] }],
      },
    });
  });

  it('rejects conversions Shapio cannot perform', async () => {
    const id = await createModel('gadget', [{ apiKey: 'specs', label: 'Specs', type: 'json' }]);
    const model = await getModel(id);
    const changed = {
      ...model.definition,
      fields: model.definition.fields.map((field) => ({ ...field, type: 'boolean', editor: undefined })),
    };
    const response = await admin.put(`/api/admin/models/${id}`, {
      definition: changed,
      expectedVersion: 1,
      acknowledgeBreaking: true,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'SCHEMA_CHANGE_UNSUPPORTED' } });
  });
});

describe('expression index builds', () => {
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

  // pageDefinition models are not localized: their indexes have no locale column.
  const indexOf = (modelId: string, fieldId: string, type: 'string' | 'integer') =>
    fieldIndexName({ modelId, fieldId, type, localized: false });

  it('builds the index of a new model after activation, and of a newly sortable field before it', async () => {
    const created = await admin.post('/api/admin/models', {
      definition: pageDefinition({
        apiKey: 'listing',
        label: 'Listing',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string', filterable: true }],
      }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ definitionId: string }>().definitionId;
    const model = (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
    const titleIndex = indexOf(id, model.definition.fields[0]?.id ?? '', 'string');
    await runSchemaJobs(database.current.db);
    expect(await getIndexState(database.current.db, titleIndex)).toBe('valid');

    const withRank = {
      ...model.definition,
      fields: [
        ...model.definition.fields,
        { apiKey: 'rank', label: 'Rank', type: 'integer', sortable: true },
      ],
    };
    const response = await admin.put(`/api/admin/models/${id}`, { definition: withRank, expectedVersion: 1 });
    expect(response.statusCode, response.body).toBe(202);
    const updated = (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
    expect(updated.version).toBe(1);
    await runSchemaJobs(database.current.db);
    const after = (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
    expect(after.version).toBe(2);
    const rankId = after.definition.fields.find((field) => field.apiKey === 'rank')?.id ?? '';
    expect(await getIndexState(database.current.db, indexOf(id, rankId, 'integer'))).toBe('valid');

    // Dropping the flag drops the index after activation.
    const unsorted = {
      ...after.definition,
      fields: after.definition.fields.map((field) => ({ ...field, sortable: false })),
    };
    expect(
      (await admin.put(`/api/admin/models/${id}`, { definition: unsorted, expectedVersion: 2 })).statusCode,
    ).toBe(200);
    await runSchemaJobs(database.current.db);
    expect(await getIndexState(database.current.db, indexOf(id, rankId, 'integer'))).toBe('missing');
    expect(await getIndexState(database.current.db, titleIndex)).toBe('valid');
  });

  it.skipIf(dialectSkipReason(import.meta.url, 'invalid index'))(
    'drops an INVALID index left by a failed build and rebuilds it',
    async () => {
      const { db } = database.current;
      const created = await admin.post('/api/admin/models', {
        definition: pageDefinition({ apiKey: 'ticket', label: 'Ticket' }),
      });
      const id = created.json<{ definitionId: string }>().definitionId;
      const model = (await admin.get(`/api/admin/models/${id}`)).json<ModelBody>();
      const fieldId = model.definition.fields[0]?.id ?? '';
      const name = indexOf(id, fieldId, 'string');
      // A failed CREATE INDEX CONCURRENTLY leaves an INVALID index behind under the deterministic name.
      for (const title of ['same', 'same']) {
        const entry = await admin.post('/api/admin/content/ticket', { data: { title } });
        expect(entry.statusCode, entry.body).toBe(201);
      }
      await expect(
        sql`create unique index concurrently ${sql.id(name)} on entry_heads ((data ->> ${sql.lit(fieldId)}))`.execute(
          db,
        ),
      ).rejects.toThrow();
      expect(await getIndexState(db, name)).toBe('invalid');

      const filterable = {
        ...model.definition,
        fields: model.definition.fields.map((field) => ({ ...field, filterable: true })),
      };
      expect(
        (await admin.put(`/api/admin/models/${id}`, { definition: filterable, expectedVersion: 1 }))
          .statusCode,
      ).toBe(202);
      await runSchemaJobs(db);
      expect(await getIndexState(db, name)).toBe('valid');
      expect((await admin.get(`/api/admin/models/${id}`)).json<ModelBody>().version).toBe(2);
    },
  );
});
