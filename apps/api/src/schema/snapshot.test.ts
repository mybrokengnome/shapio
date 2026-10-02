import { hashDefinition, normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from './snapshot.js';
import { readStoredRevision } from './storedDefinition.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(99),
  hash: 'stored',
  activatedAt: new Date(0),
});
const model = (n: number, kind: 'collection' | 'singleton', apiKey: string, pluralApiKey?: string) =>
  normalizeDefinition({
    id: uuid(n),
    kind,
    apiKey,
    ...(pluralApiKey ? { pluralApiKey } : {}),
    label: apiKey,
    fields: [],
  });

describe('route keys', () => {
  it('indexes collections by plural API ID and singletons by API ID', () => {
    const snapshot = buildSnapshot(
      1,
      [model(1, 'collection', 'article'), model(2, 'singleton', 'homepage')].map(active),
      [],
    );
    expect([...snapshot.modelsByRouteKey.keys()]).toEqual(['articles', 'homepage']);
    expect(snapshot.modelsByApiKey.has('article')).toBe(true);
    expect(snapshot.routeKeyCollisions).toEqual([]);
  });

  it('reports a collision and serves the model whose API ID is the route key', () => {
    // A collection stored before plural API IDs: its derived plural equals the singleton's API ID.
    const legacy = { ...model(1, 'collection', 'post'), pluralApiKey: undefined } as SchemaDefinition;
    const snapshot = buildSnapshot(1, [legacy, model(2, 'singleton', 'posts')].map(active), []);
    expect(snapshot.modelsByRouteKey.get('posts')?.definition.id).toBe(uuid(2));
    expect(snapshot.routeKeyCollisions).toEqual([
      { routeKey: 'posts', servedApiKey: 'posts', hiddenApiKey: 'post' },
    ]);
  });
});

describe('stored definitions', () => {
  it('fills a missing plural and re-hashes only then', async () => {
    const current = model(1, 'collection', 'category');
    expect(await readStoredRevision(current, 'stored')).toEqual({ definition: current, hash: 'stored' });

    const { pluralApiKey: _dropped, ...legacy } = current as SchemaDefinition & { pluralApiKey?: string };
    const read = await readStoredRevision(legacy, 'stored');
    expect(read.definition).toEqual(current);
    expect(read.hash).toBe(await hashDefinition(current));
  });
});
