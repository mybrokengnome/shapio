import type { LockFile } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, expectStatus, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ExportBody = {
  schemaVersion: number;
  definitions: Array<{
    definition: { id: string; kind: string; apiKey: string } & Record<string, unknown>;
    version: number;
    hash: string;
  }>;
};
type ApplyBody = {
  schemaVersion: number;
  results: Array<{ definitionId: string; outcome?: string; changeId?: string }>;
};
type ChangeBody = { status: string };

const title = { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true };

/**
 * `schema apply` activates the files it applies as one unit, whatever their order: a definition never goes
 * live before the ones it references (a parent, an interface, a relation target), even when those wait for
 * index builds first.
 */
describe('schema apply: activation order', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  const lock = async (): Promise<LockFile> => {
    const exported = expectStatus(await admin.get('/api/admin/schema/export'), 200).json<ExportBody>();
    return {
      formatVersion: 1,
      schemaVersion: exported.schemaVersion,
      definitions: Object.fromEntries(
        exported.definitions.map(({ definition, version, hash }) => [
          definition.id,
          { kind: definition.kind, apiKey: definition.apiKey, version, hash },
        ]),
      ),
    } as LockFile;
  };
  const apply = async (definitions: unknown[]) => {
    const response = await admin.post('/api/admin/schema/apply', {
      definitions,
      base: await lock(),
      acknowledgeBreaking: true,
    });
    return expectStatus(response, 200).json<ApplyBody>();
  };
  /** Runs the schema jobs, then expects every change of the apply activated. */
  const settle = async (applied: ApplyBody) => {
    await runContentSchemaJobs(database.current.db);
    for (const result of applied.results.filter((item) => item.changeId)) {
      const change = expectStatus(
        await admin.get(`/api/admin/schema/changes/${result.changeId ?? ''}`),
        200,
      ).json<ChangeBody>();
      expect(change.status, JSON.stringify(change)).toBe('activated');
    }
  };
  const activeVersion = async (category: 'models' | 'interfaces', id: string) =>
    expectStatus(await admin.get(`/api/admin/${category}/${id}`), 200).json<ModelBody>().version;
  const entry = async (apiKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${apiKey}`, { data }), 201);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const parentAndKind = (prefix: string, parentId: string, kindId: string) => {
    const parent = {
      id: parentId,
      kind: 'collection',
      apiKey: `${prefix}Post`,
      label: 'Post',
      fields: [title],
    };
    const kind = {
      id: kindId,
      kind: 'collection',
      apiKey: `${prefix}Guide`,
      label: 'Guide',
      extends: parentId,
      fields: [{ apiKey: 'summary', label: 'Summary', type: 'string' }],
    };
    return { parent, kind };
  };

  it.each([
    ['parent first', 'first', true],
    ['kind first', 'second', false],
  ])(
    'creates a type and a kind that extends it in one apply, at once (%s)',
    async (_, prefix, parentFirst) => {
      const parentId = parentFirst
        ? '00000000-0000-4000-8000-00000000b001'
        : '00000000-0000-4000-8000-00000000b003';
      const kindId = parentFirst
        ? '00000000-0000-4000-8000-00000000b002'
        : '00000000-0000-4000-8000-00000000b004';
      const { parent, kind } = parentAndKind(prefix, parentId, kindId);
      const applied = await apply(parentFirst ? [parent, kind] : [kind, parent]);
      // Neither holds entries yet, so nothing waits for an index build: both go live in the request.
      const acted = applied.results.filter((item) => item.outcome !== 'skipped');
      expect(acted.map((item) => [item.outcome, item.changeId])).toEqual([
        ['activated', undefined],
        ['activated', undefined],
      ]);
      const changeJobs = await database.current.db
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'schema.change')
        .execute();
      expect(changeJobs).toEqual([]);
      expect(await activeVersion('models', parentId)).toBe(1);
      expect(await activeVersion('models', kindId)).toBe(1);
      await entry(`${prefix}Guide`, { title: 'How to', summary: 'Short' });
    },
  );

  it('changes an interface and a member that needs an index build in one apply', async () => {
    const listable = expectStatus(
      await admin.post('/api/admin/interfaces', {
        definition: {
          kind: 'interface',
          apiKey: 'listable',
          label: 'Listable',
          fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
        },
        scope: 'network',
      }),
      201,
    ).json<{ definitionId: string }>();
    const contract = expectStatus(
      await admin.get(`/api/admin/interfaces/${listable.definitionId}`),
      200,
    ).json<ModelBody>();
    const article = await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        implements: [listable.definitionId],
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      'models',
      'network',
    );
    // The article holds content, so its new filterable field waits for its index; the interface has none.
    await entry('article', { title: 'Hello' });
    const rank = { apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true };
    const applied = await apply([
      { ...contract.definition, fields: [...contract.definition.fields, rank] },
      { ...article.definition, fields: [...article.definition.fields, rank] },
    ]);
    const outcomes = applied.results.filter((item) => item.outcome !== 'skipped').map((item) => item.outcome);
    expect(outcomes).toEqual(['pending', 'pending']);
    await settle(applied);
    expect(await activeVersion('interfaces', listable.definitionId)).toBe(2);
    expect(await activeVersion('models', article.definition.id)).toBe(2);
  });

  it('creates a type that references a relation target needing an index build in one apply', async () => {
    const author = await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'author',
        label: 'Author',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      },
      'models',
      'network',
    );
    await entry('author', { name: 'Ann' });
    const bookId = '00000000-0000-4000-8000-00000000b010';
    const book = {
      id: bookId,
      kind: 'collection',
      apiKey: 'book',
      label: 'Book',
      fields: [
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    };
    const changedAuthor = {
      ...author.definition,
      fields: [
        ...author.definition.fields,
        { apiKey: 'born', label: 'Born', type: 'integer', sortable: true },
      ],
    };
    const applied = await apply([book, changedAuthor]);
    await settle(applied);
    expect(await activeVersion('models', author.definition.id)).toBe(2);
    expect(await activeVersion('models', bookId)).toBe(1);
  });
});
