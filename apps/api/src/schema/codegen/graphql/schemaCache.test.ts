import type { GraphQLSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import { buildSnapshot } from '../../snapshot.js';
import { createGraphqlSchemaCache } from './schemaCache.js';

describe('GraphQL schema cache', () => {
  it('rebuilds once for concurrent requests and never moves backwards', async () => {
    const applied: GraphQLSchema[] = [];
    const cache = createGraphqlSchemaCache((schema) => applied.push(schema), silentLogger);
    const v2 = buildSnapshot(2, [], []);
    await Promise.all([cache.ensure(v2), cache.ensure(v2), cache.ensure(v2)]);
    expect(applied).toHaveLength(1);
    expect(cache.current()?.version).toBe(2);

    await cache.ensure(buildSnapshot(1, [], []));
    expect(applied).toHaveLength(1);
    expect(cache.current()?.version).toBe(2);

    await Promise.all([cache.ensure(buildSnapshot(3, [], [])), cache.ensure(buildSnapshot(4, [], []))]);
    expect(cache.current()?.version).toBe(4);
    expect(applied.at(-1)).toBe(cache.current()?.schema);
  });
});
