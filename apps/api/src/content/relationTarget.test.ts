import { ANY_TARGET, normalizeDefinition, type FieldDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildNetworkSchema, buildSnapshot, type ActiveDefinition } from '../schema/snapshot.js';
import { apiKeyOfRoute, resolveContentRoute, resolveModelById } from './model.js';
import { relationTargetKey, relationTargetOf, targetAcceptsModel } from './relationTarget.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const active = (definition: SchemaDefinition, siteId: string | null = null): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(99),
  hash: 'stored',
  activatedAt: new Date(0),
  siteId,
});
const title = (n: number) => ({ id: uuid(n), apiKey: 'title', label: 'Title', type: 'string' as const });

const featurable = normalizeDefinition({
  id: uuid(1),
  kind: 'interface',
  apiKey: 'featurable',
  label: 'Featurable',
  fields: [title(11)],
});
const post = normalizeDefinition({
  id: uuid(2),
  kind: 'collection',
  apiKey: 'post',
  label: 'Post',
  implements: [uuid(1)],
  fields: [title(21)],
});
const guide = normalizeDefinition({
  id: uuid(3),
  kind: 'collection',
  apiKey: 'guide',
  label: 'Guide',
  extends: uuid(2),
  fields: [],
});
const about = normalizeDefinition({
  id: uuid(4),
  kind: 'singleton',
  apiKey: 'about',
  label: 'About',
  implements: [uuid(1)],
  fields: [title(41)],
});
const tag = normalizeDefinition({ id: uuid(5), kind: 'collection', apiKey: 'tag', label: 'Tag', fields: [] });

const snapshot = buildSnapshot(
  1,
  [featurable, post, guide, about, tag].map((definition) => active(definition)),
  [],
);

const relation = (target: string) =>
  ({
    id: uuid(50),
    apiKey: 'featured',
    label: 'Featured',
    type: 'relation',
    settings: { target, cardinality: 'many' },
  }) as unknown as FieldDefinition<'relation'>;

describe('relationTargetOf', () => {
  it('model: a collection and its kinds', () => {
    const target = relationTargetOf(snapshot, relation(uuid(2)));
    expect(target).toEqual({ kind: 'model', id: uuid(2), modelIds: [uuid(2), uuid(3)] });
    expect(targetAcceptsModel(snapshot, target, uuid(3))).toBe(true);
    expect(targetAcceptsModel(snapshot, target, uuid(4))).toBe(false);
  });

  it('interface: every member in the view, kinds and singletons included', () => {
    const target = relationTargetOf(snapshot, relation(uuid(1)));
    expect(target).toEqual({ kind: 'interface', id: uuid(1), modelIds: [uuid(2), uuid(3), uuid(4)] });
    expect(targetAcceptsModel(snapshot, target, uuid(4))).toBe(true);
    expect(targetAcceptsModel(snapshot, target, uuid(5))).toBe(false);
    expect(relationTargetKey(target)).toBe(`${uuid(1)}=${uuid(2)},${uuid(3)},${uuid(4)}`);
  });

  it('any: no model list; accepts any collection or singleton, never an interface', () => {
    const target = relationTargetOf(snapshot, relation(ANY_TARGET));
    expect(target).toEqual({ kind: 'any' });
    expect(targetAcceptsModel(snapshot, target, uuid(4))).toBe(true);
    expect(targetAcceptsModel(snapshot, target, uuid(1))).toBe(false);
    expect(relationTargetKey(target)).toBe(ANY_TARGET);
  });

  it('a site view sees the members on that site and the shared ones', () => {
    const local = normalizeDefinition({
      id: uuid(6),
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      implements: [uuid(1)],
      fields: [title(61)],
    });
    const network = buildNetworkSchema(1, [active(featurable), active(post), active(local, uuid(70))], []);
    expect(relationTargetOf(network.forSite(uuid(70)), relation(uuid(1)))).toMatchObject({
      modelIds: [uuid(2), uuid(6)],
    });
    expect(relationTargetOf(network.forSite(uuid(71)), relation(uuid(1)))).toMatchObject({
      modelIds: [uuid(2)],
    });
  });
});

describe('interfaces in the snapshot', () => {
  it('are never models, and have their own API ID and route key maps', () => {
    expect(snapshot.modelsByApiKey.has('featurable')).toBe(false);
    expect(snapshot.interfacesByApiKey.get('featurable')?.definition.id).toBe(uuid(1));
    expect(snapshot.interfacesByRouteKey.get('featurables')?.definition.id).toBe(uuid(1));
    expect(snapshot.modelsByRouteKey.has('featurables')).toBe(false);
    expect(snapshot.resolve(uuid(1))).toBeUndefined();
    expect(resolveModelById(snapshot, uuid(1))).toBeUndefined();
    expect(snapshot.interfacesOf(uuid(3))).toEqual([uuid(1)]);
  });

  it('resolveContentRoute and apiKeyOfRoute serve models and interfaces, nothing else', () => {
    expect(apiKeyOfRoute(snapshot, 'featurables')).toBe('featurable');
    expect(apiKeyOfRoute(snapshot, 'posts')).toBe('post');
    const route = resolveContentRoute(snapshot, 'featurable');
    expect(route.kind === 'interface' && route.memberIds).toEqual([uuid(2), uuid(3), uuid(4)]);
    expect(resolveContentRoute(snapshot, 'post')).toMatchObject({ kind: 'model' });
    expect(() => resolveContentRoute(snapshot, 'featurables')).toThrow(/No content model/);
  });
});
