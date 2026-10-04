import { DefaultQueryExecutor, type CompiledQuery } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ExecuteQuery = (this: unknown, query: CompiledQuery, ...rest: unknown[]) => Promise<unknown>;

/**
 * Records the SQL of every statement Kysely runs, on the pool and in transactions alike (each executor
 * extends the same base class). BEGIN and COMMIT go through the driver, so they are not counted.
 */
const recordStatements = () => {
  const base = Object.getPrototypeOf(DefaultQueryExecutor.prototype) as { executeQuery: ExecuteQuery };
  const original = base.executeQuery;
  const statements: string[] = [];
  base.executeQuery = function (query, ...rest) {
    statements.push(query.sql);
    return original.call(this, query, ...rest);
  };
  return {
    statements,
    restore: () => {
      base.executeQuery = original;
    },
  };
};

const versionReads = (statements: readonly string[]) =>
  statements.filter((sql) => /system_versions/.test(sql)).length;
const siteReads = (statements: readonly string[]) =>
  statements.filter((sql) => /from ["`]?sites["`]?/i.test(sql)).length;

describe('version checks per request', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let entry: EntryBody;
  let token: string;
  let recorder: ReturnType<typeof recordStatements> | undefined;

  /** The statements one request runs (caches warmed by an identical request first). */
  const statementsOf = async (send: () => Promise<{ statusCode: number }>) => {
    expect((await send()).statusCode).toBe(200);
    recorder = recordStatements();
    try {
      expect((await send()).statusCode).toBe(200);
      return [...recorder.statements];
    } finally {
      recorder.restore();
      recorder = undefined;
    }
  };

  const deliver = (url: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
      display: {},
    });
    const writer = expectStatus(
      await admin.post('/api/admin/content/author', { data: { name: 'Ada' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/author/${writer.id}/publish`, {}), 200);
    entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Hello', author: writer.id } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    token = await createDeliveryToken(database.current.db, [
      { modelId: article.definition.id },
      { modelId: author.definition.id },
    ]);
  });
  afterEach(() => {
    recorder?.restore();
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it.each([
    ['delivery list', '/api/content/articles'],
    ['delivery list with populate', '/api/content/articles?populate=author'],
    ['delivery entry', () => `/api/content/articles/${entry.id}`],
    ['delivery list on a named site', '/api/content/articles?site=default'],
  ])('reads the versions and the site once: %s', async (_name, url) => {
    const statements = await statementsOf(() => deliver(typeof url === 'string' ? url : url()));
    expect(versionReads(statements)).toBe(1);
    expect(siteReads(statements)).toBe(0);
  });

  it.each([
    ['admin list', '/api/admin/content/article'],
    ['admin entry', () => `/api/admin/content/article/${entry.id}`],
  ])('reads the versions and the site once: %s', async (_name, url) => {
    const statements = await statementsOf(() => admin.get(typeof url === 'string' ? url : url()));
    expect(versionReads(statements)).toBe(1);
    expect(siteReads(statements)).toBe(0);
  });

  it("writes a token's last use at most once per interval", async () => {
    const fresh = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
    const send = () =>
      testApp.app.inject({
        method: 'GET',
        url: '/api/content/articles',
        headers: { authorization: `Bearer ${fresh}` },
      });
    const record = async () => {
      recorder = recordStatements();
      try {
        expect((await send()).statusCode).toBe(200);
        return [...recorder.statements];
      } finally {
        recorder.restore();
        recorder = undefined;
      }
    };
    // Warm the caches (the new token's role moved the permissions version), then forget its last use.
    expect((await send()).statusCode).toBe(200);
    await database.current.db.updateTable('api_tokens').set({ last_used_at: null }).execute();
    const first = await record();
    const second = await record();
    const tokenWrites = (statements: readonly string[]) =>
      statements.filter((sql) => /^update ["`]?api_tokens/i.test(sql)).length;
    expect(tokenWrites(first)).toBe(1);
    expect(tokenWrites(second)).toBe(0);
    expect(second).toHaveLength(first.length - 1);
  });

  it('reads the versions once for a GraphQL query', async () => {
    const statements = await statementsOf(() =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/graphql',
        headers: { authorization: `Bearer ${token}` },
        payload: { query: '{ articles { nodes { title author { name } } } }' },
      }),
    );
    expect(versionReads(statements)).toBe(1);
  });
});
