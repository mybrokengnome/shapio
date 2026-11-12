import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearItemIdCache, setItemIdCacheEnabled } from '../src/content/itemIdCache.js';
import { itemIdKeyOf, itemIdsDerived } from '../src/content/itemIds.js';
import { createDb } from '../src/db/index.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { bearer } from './helpers/appUsers.js';
import { createDeliveryToken, expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql } from './helpers/graphql.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';

/**
 * The item ID cache on content written by main's code (plan item-ids-perf): opt in with
 * `ITEM_ID_CACHE_MAIN_CORPUS=<a SQLite seed.db the main differential left>` (apps/api/test/helpers/mainDiff/run.sh
 * sqlite writes `<scratch>/out-sqlite-<seed>/seed.db`). A copy of it is upgraded by this branch's migrations; every
 * entry is then read through the admin API, REST delivery (with `?snapshot=` and a pinned schema version) and
 * GraphQL with the cache on and off: the same bytes, and a repeated read derives nothing.
 */
const SOURCE = process.env.ITEM_ID_CACHE_MAIN_CORPUS ?? '';

type Field = {
  name: string;
  args: Array<{ type: { kind: string } }>;
  type: TypeRef;
};
type TypeRef = { kind: string; name: string | null; ofType: TypeRef | null };
type GraphqlType = {
  name: string;
  kind: string;
  fields: Field[] | null;
  possibleTypes: Array<{ name: string }> | null;
};

const INTROSPECTION = `{ __schema { queryType { name } types { name kind possibleTypes { name }
  fields { name args { type { kind } } type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } }`;

const named = (type: TypeRef): TypeRef => (type.ofType ? named(type.ofType) : type);

/** A selection of every field reachable within `depth` levels (fields without required arguments). */
const selectionOf = (types: Map<string, GraphqlType>, typeName: string, depth: number): string => {
  const type = types.get(typeName);
  if (!type) {
    return '__typename';
  }
  if (type.kind === 'UNION' || type.kind === 'INTERFACE') {
    return `__typename ${(type.possibleTypes ?? [])
      .map((member) => `... on ${member.name} { ${selectionOf(types, member.name, depth - 1)} }`)
      .join(' ')}`;
  }
  const parts = (type.fields ?? []).flatMap((field) => {
    if (field.args.some((arg) => arg.type.kind === 'NON_NULL')) {
      return [];
    }
    const target = named(field.type);
    if (target.kind === 'SCALAR' || target.kind === 'ENUM') {
      return [field.name];
    }
    return depth > 0 && target.name
      ? [`${field.name} { ${selectionOf(types, target.name, depth - 1)} }`]
      : [];
  });
  return ['__typename', ...parts].join(' ');
};

describe.skipIf(!SOURCE || !existsSync(SOURCE))('item ID cache on a corpus written by main', () => {
  const url = `sqlite:${SOURCE}.cache-check.db`;
  let db: ReturnType<typeof createDb>;
  let testApp: TestApp;
  let adminToken: string;
  let deliveryToken: string;
  const urls: Array<[string, string]> = [];
  let graphqlQueries: string[] = [];

  beforeAll(async () => {
    copyFileSync(SOURCE, `${SOURCE}.cache-check.db`);
    db = createDb({ connectionString: url, poolMax: 4 });
    await migrateToLatest(db, silentLogger);
    testApp = await createTestApp(
      { name: 'item-id-cache-main', url, db, drop: async () => db.destroy() },
      { schemaListen: false, env: { GRAPHQL_ENABLED: 'true', RATE_LIMIT_MAX: '1000000' } },
    );
    adminToken = await createRoleToken(db);
    const get = async <T>(path: string, token = adminToken) =>
      expectStatus(
        await testApp.app.inject({ method: 'GET', url: path, headers: bearer(token) }),
        200,
      ).json<T>();
    const models = await get<
      { items?: Array<{ definition: ModelDefinitionBody }> } | Array<{ definition: ModelDefinitionBody }>
    >('/api/admin/models');
    const collections = (Array.isArray(models) ? models : (models.items ?? []))
      .map((model) => model.definition)
      .filter((definition) => definition.kind === 'collection');
    deliveryToken = await createDeliveryToken(
      db,
      collections.map((definition) => ({ modelId: definition.id })),
    );
    const locales = await get<Array<{ code: string }> | { items: Array<{ code: string }> }>(
      '/api/admin/locales',
    );
    const codes = (Array.isArray(locales) ? locales : locales.items).map((locale) => locale.code);
    const current = await get<{ snapshot: number; schemaVersionToken: string }>(
      '/api/snapshots/current',
      deliveryToken,
    );
    const version = encodeURIComponent(current.schemaVersionToken);
    for (const definition of collections) {
      const list = await get<{ items?: Array<{ id: string }>; data?: Array<{ id: string }> }>(
        `/api/admin/content/${definition.apiKey}?pageSize=100`,
      );
      const ids = (list.items ?? list.data ?? []).map((entry) => entry.id);
      for (const locale of codes) {
        const plural = definition.pluralApiKey;
        urls.push(
          [`/api/admin/content/${definition.apiKey}?pageSize=100&locale=${locale}`, adminToken],
          ...ids.map((id): [string, string] => [
            `/api/admin/content/${definition.apiKey}/${id}?locale=${locale}`,
            adminToken,
          ]),
          [`/api/content/${plural}?pageSize=100&locale=${locale}`, deliveryToken],
          ...ids.map((id): [string, string] => [
            `/api/content/${plural}/${id}?locale=${locale}`,
            deliveryToken,
          ]),
          [
            `/api/content/${plural}?pageSize=100&locale=${locale}&snapshot=${current.snapshot}`,
            deliveryToken,
          ],
          [`/api/content/${plural}?pageSize=100&locale=${locale}&schemaVersion=${version}`, deliveryToken],
          [`/api/content/${plural}?pageSize=100&locale=${locale}&publicationState=preview`, adminToken],
        );
      }
    }
    const introspection = await graphql<{
      __schema: { queryType: { name: string }; types: GraphqlType[] };
    }>(testApp.app, INTROSPECTION, { headers: bearer(deliveryToken) });
    const schema = introspection.body.data?.__schema;
    const types = new Map((schema?.types ?? []).map((type) => [type.name, type]));
    const query = types.get(schema?.queryType.name ?? '');
    graphqlQueries = collections.flatMap((definition) => {
      const root = query?.fields?.find((field) => field.name === definition.pluralApiKey);
      const target = root ? named(root.type).name : null;
      return target
        ? [`{ ${definition.pluralApiKey}(pageSize: 100) { ${selectionOf(types, target, 6)} } }`]
        : [];
    });
  });
  afterAll(async () => {
    setItemIdCacheEnabled(true);
    await testApp?.app.close();
  });

  /** Signed private-media URLs expire relative to the clock: every pass reads at the same instant. */
  const READ_AT = new Date('2026-11-12T12:00:00.000Z');
  const reads = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
    try {
      return await readAll();
    } finally {
      vi.useRealTimers();
    }
  };
  const readAll = async () => {
    const bodies: string[] = [];
    for (const [path, token] of urls) {
      const response = await testApp.app.inject({ method: 'GET', url: path, headers: bearer(token) });
      bodies.push(`${path} ${response.statusCode} ${response.headers.etag ?? ''} ${response.body}`);
    }
    for (const query of graphqlQueries) {
      const result = await graphql(testApp.app, query, { headers: bearer(deliveryToken), method: 'GET' });
      bodies.push(
        `${query} ${result.statusCode} ${result.response.headers.etag ?? ''} ${result.response.body}`,
      );
    }
    return bodies;
  };

  it('answers every read the same with the cache on and off, and derives nothing on a repeated read', async () => {
    expect(urls.length).toBeGreaterThan(0);
    expect(graphqlQueries.length).toBeGreaterThan(0);
    clearItemIdCache(await itemIdKeyOf(db));
    const start = itemIdsDerived();
    const first = await reads();
    // main's content stores no item IDs: the first read derives them.
    expect(itemIdsDerived()).toBeGreaterThan(start);
    const before = itemIdsDerived();
    const again = await reads();
    expect(itemIdsDerived()).toBe(before);
    setItemIdCacheEnabled(false);
    const off = await reads();
    setItemIdCacheEnabled(true);
    const differing = (left: string[]) =>
      left.flatMap((body, index) => (body === off[index] ? [] : [{ cached: body, off: off[index] }]));
    if (process.env.ITEM_ID_CACHE_MAIN_CORPUS_DUMP) {
      writeFileSync(process.env.ITEM_ID_CACHE_MAIN_CORPUS_DUMP, JSON.stringify(differing(first), null, 1));
    }
    expect(differing(first)).toEqual([]);
    expect(differing(again)).toEqual([]);
    expect(first.filter((body) => / 200 /.test(body)).length).toBeGreaterThan(urls.length / 2);
  });
});

type ModelDefinitionBody = { id: string; kind: string; apiKey: string; pluralApiKey: string };
