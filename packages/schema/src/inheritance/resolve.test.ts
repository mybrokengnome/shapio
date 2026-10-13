import { describe, expect, it } from 'vitest';
import { component, field, id, model } from '../testing/fixtures.js';
import type { ModelDefinition, SchemaDefinition } from '../types/definitions.js';
import {
  ancestorChain,
  createDefinitionIndex,
  findChildDefinitions,
  MAX_INHERITANCE_DEPTH,
  mergeDisplay,
  ownFields,
  resolveModelDefinition,
} from './resolve.js';

const lookupOf = (definitions: readonly SchemaDefinition[]) => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return (key: string) => byId.get(key);
};

const products = model({
  id: id(1),
  apiKey: 'product',
  pluralApiKey: 'products',
  fields: [field({ id: id(11), apiKey: 'name' }), field({ id: id(12), apiKey: 'price', type: 'integer' })],
});
const physical = model({
  id: id(2),
  apiKey: 'physicalProduct',
  pluralApiKey: 'physical',
  extends: id(1),
  fields: [field({ id: id(21), apiKey: 'weight', type: 'integer' })],
});
const apparel = model({
  id: id(3),
  apiKey: 'apparel',
  pluralApiKey: 'apparels',
  extends: id(2),
  fields: [field({ id: id(31), apiKey: 'size' })],
});
const digital = model({
  id: id(4),
  apiKey: 'digitalProduct',
  pluralApiKey: 'digital',
  extends: id(1),
  fields: [field({ id: id(41), apiKey: 'downloadUrl', type: 'url' })],
});
const family = [products, physical, apparel, digital];

/** A straight chain of `levels` collections, root first; each extends the one before. */
const chainOf = (levels: number): ModelDefinition[] =>
  Array.from({ length: levels }, (_, index) =>
    model({
      id: id(100 + index),
      apiKey: `level${index}`,
      ...(index > 0 ? { extends: id(100 + index - 1) } : {}),
    }),
  );

describe('ancestorChain', () => {
  it('lists ancestors root first', () => {
    expect(ancestorChain(apparel, lookupOf(family))).toEqual({ ids: [id(1), id(2)] });
    expect(ancestorChain(products, lookupOf(family))).toEqual({ ids: [] });
  });

  it('stops at a missing parent', () => {
    const orphan = model({ id: id(9), apiKey: 'orphan', extends: id(99) });
    expect(ancestorChain(orphan, lookupOf([orphan]))).toEqual({
      ids: [],
      problem: 'missing',
      problemAt: id(9),
    });
  });

  it('stops at a parent that is not a collection, or the model itself', () => {
    const single = model({ id: id(8), apiKey: 'home', kind: 'singleton' });
    const child = model({ id: id(9), apiKey: 'child', extends: id(8) });
    expect(ancestorChain(child, lookupOf([single, child])).problem).toBe('invalid');
    const hero = component({ id: id(7), apiKey: 'hero' });
    const ofComponent = model({ id: id(9), apiKey: 'child', extends: id(7) });
    expect(ancestorChain(ofComponent, lookupOf([hero, ofComponent])).problem).toBe('invalid');
    const self = model({ id: id(9), apiKey: 'self', extends: id(9) });
    expect(ancestorChain(self, lookupOf([self])).problem).toBe('invalid');
  });

  it('stops at a cycle', () => {
    const a = model({ id: id(5), apiKey: 'a', extends: id(6) });
    const b = model({ id: id(6), apiKey: 'b', extends: id(5) });
    expect(ancestorChain(a, lookupOf([a, b]))).toEqual({ ids: [id(6)], problem: 'cycle', problemAt: id(6) });
  });

  it(`allows ${MAX_INHERITANCE_DEPTH} levels and stops past them`, () => {
    const allowed = chainOf(MAX_INHERITANCE_DEPTH);
    expect(ancestorChain(allowed.at(-1) as ModelDefinition, lookupOf(allowed)).problem).toBeUndefined();
    const deep = chainOf(MAX_INHERITANCE_DEPTH + 1);
    const chain = ancestorChain(deep.at(-1) as ModelDefinition, lookupOf(deep));
    expect(chain.problem).toBe('tooDeep');
    expect(chain.ids).toHaveLength(MAX_INHERITANCE_DEPTH - 1);
  });
});

describe('resolveModelDefinition', () => {
  it('puts ancestors’ fields first, root first, marked with the declaring model', () => {
    const resolved = resolveModelDefinition(apparel, lookupOf(family));
    expect(resolved.fields.map((candidate) => [candidate.apiKey, candidate.inheritedFrom])).toEqual([
      ['name', id(1)],
      ['price', id(1)],
      ['weight', id(2)],
      ['size', undefined],
    ]);
    expect(resolved.ancestorIds).toEqual([id(1), id(2)]);
    expect(resolved.extends).toBe(id(2));
  });

  it('keeps inherited fields identical apart from the marker', () => {
    const resolved = resolveModelDefinition(digital, lookupOf(family));
    const { inheritedFrom, ...price } = resolved.fields[1] as (typeof resolved.fields)[number];
    expect(inheritedFrom).toBe(id(1));
    expect(price).toEqual(products.fields[1]);
  });

  it('resolves a root to itself with no ancestors', () => {
    const resolved = resolveModelDefinition(products, lookupOf(family));
    expect(resolved.fields).toEqual(products.fields);
    expect(resolved.display).toEqual(products.display);
    expect(resolved.ancestorIds).toEqual([]);
  });

  it('resolves over the part of a broken chain that resolves', () => {
    const orphan = model({ id: id(9), apiKey: 'orphan', extends: id(99), fields: [field({ apiKey: 'x' })] });
    const resolved = resolveModelDefinition(orphan, lookupOf([orphan]));
    expect(resolved.fields.map((candidate) => candidate.apiKey)).toEqual(['x']);
    expect(resolved.ancestorIds).toEqual([]);
  });

  it('ownFields drops the inherited ones', () => {
    expect(ownFields(resolveModelDefinition(apparel, lookupOf(family)))).toEqual(apparel.fields);
  });
});

describe('mergeDisplay', () => {
  const body = field({ id: id(51), apiKey: 'body', type: 'richtext' });
  const note = field({ id: id(52), apiKey: 'note' });
  const own = model({ apiKey: 'own', fields: [body, note] }).fields;

  it('takes the child’s scalars and lists when set, else the parent’s', () => {
    const parent = {
      layout: 'form' as const,
      titleFieldId: id(11),
      listFieldIds: [id(11)],
      defaultSort: { fieldId: id(12), direction: 'asc' as const },
      coverFieldId: id(13),
    };
    expect(mergeDisplay(parent, {}, own)).toEqual(parent);
    const child = {
      layout: 'document' as const,
      titleFieldId: id(52),
      listFieldIds: [id(52)],
      defaultSort: { fieldId: id(52), direction: 'desc' as const },
      coverFieldId: id(14),
    };
    expect(mergeDisplay(parent, child, own)).toEqual(child);
  });

  it('puts the parent’s groups before the child’s', () => {
    const merged = mergeDisplay(
      { groups: [{ id: 'g1', label: 'One', fieldIds: [id(11)] }] },
      { groups: [{ id: 'g2', label: 'Two', fieldIds: [id(52)] }] },
      own,
    );
    expect(merged.groups?.map((group) => group.id)).toEqual(['g1', 'g2']);
  });

  it('appends the child’s own fields to an inherited canvas and strip, by the automatic rule', () => {
    const merged = mergeDisplay({ canvasFieldIds: [id(15)], stripFieldIds: [id(11)] }, {}, own);
    expect(merged.canvasFieldIds).toEqual([id(15), id(51)]);
    expect(merged.stripFieldIds).toEqual([id(11), id(52)]);
  });

  it('keeps the child’s own canvas and strip when set, and leaves unset ones unset', () => {
    expect(
      mergeDisplay({ canvasFieldIds: [id(15)] }, { canvasFieldIds: [id(52)] }, own).canvasFieldIds,
    ).toEqual([id(52)]);
    expect(mergeDisplay({}, {}, own)).toEqual({});
  });

  it('merges down a chain: the grandparent’s title reaches the grandchild', () => {
    const root = model({ ...products, display: { titleFieldId: id(11) } });
    const resolved = resolveModelDefinition(apparel, lookupOf([root, physical, apparel]));
    expect(resolved.display.titleFieldId).toBe(id(11));
  });
});

describe('createDefinitionIndex', () => {
  const index = createDefinitionIndex([...family, component({ id: id(6), apiKey: 'hero' })]);

  it('answers ancestors, children, descendants, family and root', () => {
    expect(index.ancestors(id(3))).toEqual([id(1), id(2)]);
    expect(index.childrenOf(id(1))).toEqual([id(2), id(4)]);
    expect(index.descendants(id(1))).toEqual([id(2), id(3), id(4)]);
    expect(index.family(id(2))).toEqual([id(2), id(3)]);
    expect(index.rootOf(id(3))).toBe(id(1));
    expect(index.rootOf(id(1))).toBe(id(1));
  });

  it('resolves models only, and memoises', () => {
    expect(index.resolve(id(6))).toBeUndefined();
    expect(index.resolve(id(99))).toBeUndefined();
    expect(index.resolve(id(3))).toBe(index.resolve(id(3)));
    expect(index.resolve(id(3))?.fields).toHaveLength(4);
  });

  it('gives empty answers for unknown IDs and survives cycles', () => {
    expect(index.ancestors(id(99))).toEqual([]);
    expect(index.family(id(99))).toEqual([id(99)]);
    const a = model({ id: id(5), apiKey: 'a', extends: id(6) });
    const b = model({ id: id(6), apiKey: 'b', extends: id(5) });
    const cyclic = createDefinitionIndex([a, b]);
    expect(cyclic.descendants(id(5))).toEqual([id(6)]);
  });

  it('findChildDefinitions lists direct children', () => {
    expect(findChildDefinitions(family, id(1)).map((child) => child.id)).toEqual([id(2), id(4)]);
    expect(findChildDefinitions(family, id(3))).toEqual([]);
  });
});
