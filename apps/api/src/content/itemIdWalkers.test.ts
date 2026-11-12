import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../schema/snapshot.js';
import { imageUsesOf } from './health/imageUses.js';
import { mediaIdsOf as documentMediaIds, mediaUsesOf } from './media.js';
import { ownerContainers } from './migration/paths.js';
import { resolveModel } from './model.js';
import { edgesOf, targetsByModel } from './relations.js';
import { mediaIdsOf as referencedMediaIds } from './write/references.js';

/**
 * Walkers that read stored documents by field (plan item-ids, review 3.8): every component item carries a
 * server-assigned `__id` beside `__component`. These walkers must read by field ID only, so an item's `__id`
 * (a UUID, the same shape as an entry or asset ID) is never taken for a relation target or a media asset.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ITEM_ID = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-11T12:00:00.000Z');

const card = normalizeDefinition({
  id: id(100),
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [
    { id: id(101), apiKey: 'heading', label: 'Heading', type: 'string' },
    { id: id(102), apiKey: 'photo', label: 'Photo', type: 'media' },
    {
      id: id(103),
      apiKey: 'link',
      label: 'Link',
      type: 'relation',
      settings: { target: id(1), cardinality: 'one' },
    },
  ],
}) as ComponentDefinition;

const page = normalizeDefinition({
  id: id(1),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  fields: [
    { id: id(2), apiKey: 'title', label: 'Title', type: 'string' },
    { id: id(3), apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: id(100) } },
    {
      id: id(4),
      apiKey: 'cards',
      label: 'Cards',
      type: 'component',
      settings: { component: id(100), repeatable: true },
    },
    { id: id(5), apiKey: 'zone', label: 'Zone', type: 'dynamiczone', settings: { components: [id(100)] } },
  ],
}) as ModelDefinition;

const snapshot = buildSnapshot(
  1,
  [page, card].map((definition, index) => ({
    definition,
    version: 1,
    revisionId: id(900 + index),
    hash: 'x',
    activatedAt: NOW,
    siteId: null,
  })),
  [{ code: 'en', label: 'English', isDefault: true, fallbacks: [] }],
);
const model = resolveModel(snapshot, 'page');

const item = (n: number) => ({
  __id: ITEM_ID(n),
  [id(101)]: `Card ${n}`,
  [id(102)]: id(500 + n),
  [id(103)]: id(700 + n),
});

const data = {
  [id(2)]: 'Home',
  [id(3)]: item(1),
  [id(4)]: [item(2), item(3)],
  [id(5)]: [{ __component: id(100), ...item(4) }],
};

const itemIds = [1, 2, 3, 4].map(ITEM_ID);
const assets = [1, 2, 3, 4].map((n) => id(500 + n));
const targets = [1, 2, 3, 4].map((n) => id(700 + n));

describe('walkers that read stored documents by field', () => {
  it('relations: derives edges from relation fields only, never from item IDs', () => {
    const edges = edgesOf(model, data);
    expect(edges.map((edge) => edge.targetEntryId)).toEqual(targets);
    expect(edges.every((edge) => edge.fieldId === id(103))).toBe(true);
    const mentioned = [...(targetsByModel(model, [data]).get(id(1)) ?? [])];
    expect(mentioned).toEqual(targets);
    expect(mentioned.some((target) => itemIds.includes(target))).toBe(false);
  });

  it('media: collects media fields only, never item IDs', () => {
    expect(mediaUsesOf(model, data).map((use) => use.assetId)).toEqual(assets);
    expect([...documentMediaIds(model, [data], model.definition.fields)]).toEqual(assets);
  });

  it('image uses: reports media at their item paths, never item IDs', () => {
    expect(imageUsesOf(model, data).map(({ path, assetId }) => ({ path, assetId }))).toEqual([
      { path: '/hero/photo', assetId: assets[0] },
      { path: '/cards/0/photo', assetId: assets[1] },
      { path: '/cards/1/photo', assetId: assets[2] },
      { path: '/zone/0/photo', assetId: assets[3] },
    ]);
  });

  it('write references: the assets a write must check exclude item IDs', () => {
    expect([...referencedMediaIds(model, [data])]).toEqual(assets);
  });

  it('migration paths: finds component instances with their item IDs intact', () => {
    const repeated = ownerContainers(data, [id(4)], id(100));
    expect(repeated.map((container) => container.__id)).toEqual([ITEM_ID(2), ITEM_ID(3)]);
    // A zone item is matched by its component, whatever else it carries.
    const zoned = ownerContainers(data, [id(5)], id(100));
    expect(zoned.map((container) => container.__id)).toEqual([ITEM_ID(4)]);
    expect(ownerContainers(data, [id(5)], id(999))).toEqual([]);
    // The returned objects are the stored items themselves (callers mutate a clone).
    expect(ownerContainers(data, [id(3)], id(100))[0]).toBe(data[id(3)]);
  });
});
