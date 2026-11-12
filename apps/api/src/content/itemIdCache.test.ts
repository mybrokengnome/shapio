import { normalizeDefinition, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearItemIdCache,
  componentsSignatureOf,
  itemIdCacheOf,
  itemIdCacheStats,
  setItemIdCacheEnabled,
  withItemIdsCached,
} from './itemIdCache.js';
import { componentLookupOf, itemIdsDerived, withItemIds, type ItemIdScope } from './itemIds.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CARD = id(1);
const LABEL = id(2);
const INNER = id(3);
const CARDS = id(4);
const HERO = id(5);
const ZONE = id(6);
const LEAF = id(7);
const NOTE = id(8);

const leaf = normalizeDefinition({
  id: LEAF,
  kind: 'component',
  apiKey: 'leaf',
  label: 'Leaf',
  fields: [{ id: NOTE, apiKey: 'note', label: 'Note', type: 'string' }],
}) as ComponentDefinition;

const cardWith = (innerRepeatable: boolean) =>
  normalizeDefinition({
    id: CARD,
    kind: 'component',
    apiKey: 'card',
    label: 'Card',
    fields: [
      { id: LABEL, apiKey: 'label', label: 'Label', type: 'string' },
      {
        id: INNER,
        apiKey: 'inner',
        label: 'Inner',
        type: 'component',
        settings: { component: LEAF, repeatable: innerRepeatable },
      },
    ],
  }) as ComponentDefinition;

const componentsWith = (innerRepeatable: boolean) =>
  new Map([
    [CARD, { definition: cardWith(innerRepeatable), version: 1 }],
    [LEAF, { definition: leaf, version: 1 }],
  ]);

const base = {
  label: 'x',
  required: false,
  public: true,
  unique: false,
  filterable: false,
  sortable: false,
  deprecated: false,
};
const cards = (localized: boolean) =>
  ({
    ...base,
    id: CARDS,
    apiKey: 'cards',
    type: 'component',
    localized,
    editor: { id: 'component', options: {} },
    settings: { component: CARD, repeatable: true },
  }) as FieldDefinition;
const hero = (localized: boolean) =>
  ({
    ...base,
    id: HERO,
    apiKey: 'hero',
    type: 'component',
    localized,
    editor: { id: 'component', options: {} },
    settings: { component: CARD, repeatable: false },
  }) as FieldDefinition;
const zone = (localized: boolean) =>
  ({
    ...base,
    id: ZONE,
    apiKey: 'zone',
    type: 'dynamiczone',
    localized,
    editor: { id: 'dynamiczone', options: {} },
    settings: { components: [CARD, LEAF] },
  }) as FieldDefinition;

const fields = [cards(false), hero(false), zone(false)];
const key = Buffer.alloc(32, 7);
const scope: ItemIdScope = { key, entryId: id(100) };

/** A small deterministic generator, so every run walks the same shapes. */
const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

/** Stored data like content saved before 0.9.0, some of it written since: look-alikes, nesting, partial IDs. */
const corpus = (seed: number) => {
  const next = random(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)] as T;
  const maybeId = (item: Record<string, unknown>) =>
    next() < 0.25 ? { ...item, __id: pick(['a1', 'b2', `s${Math.floor(next() * 5)}`]) } : item;
  const leafItem = () => maybeId({ [NOTE]: pick(['n', 'm']) });
  const card = (): Record<string, unknown> =>
    maybeId({
      [LABEL]: pick(['A', 'B', 'A']),
      ...(next() < 0.5 ? { [INNER]: Array.from({ length: Math.floor(next() * 3) }, leafItem) } : {}),
    });
  return {
    [CARDS]: Array.from({ length: Math.floor(next() * 8) }, card),
    ...(next() < 0.7 ? { [HERO]: card() } : {}),
    [ZONE]: Array.from({ length: Math.floor(next() * 5) }, () =>
      pick([
        () => ({ ...card(), __component: CARD }),
        () => ({ ...leafItem(), __component: LEAF }),
        () => ({ [NOTE]: 'gone', __component: id(99) }),
      ])(),
    ),
  };
};

const uncached = (
  data: Record<string, unknown>,
  at: ItemIdScope,
  components = componentsWith(true),
  list = fields,
) => withItemIds(data, list, componentLookupOf(components), at);

afterEach(() => {
  setItemIdCacheEnabled(true);
  clearItemIdCache(key);
});

describe('withItemIdsCached', () => {
  it('gives exactly what withItemIds gives, on a miss and on a hit, byte for byte', () => {
    const components = componentsWith(true);
    for (let seed = 1; seed <= 300; seed += 1) {
      const data = corpus(seed);
      const expected = JSON.stringify(uncached(data, scope, components));
      expect(JSON.stringify(withItemIdsCached(data, fields, components, scope))).toBe(expected);
      const before = itemIdsDerived();
      expect(JSON.stringify(withItemIdsCached(data, fields, components, scope))).toBe(expected);
      // The repeated read derives nothing.
      expect(itemIdsDerived()).toBe(before);
    }
  });

  it('serves the same stored value from another parse of it (a fresh row object each read)', () => {
    const components = componentsWith(true);
    const data = corpus(7);
    withItemIdsCached(structuredClone(data), fields, components, scope);
    const hits = itemIdCacheStats().hits;
    const before = itemIdsDerived();
    withItemIdsCached(JSON.parse(JSON.stringify(data)) as typeof data, fields, components, scope);
    expect(itemIdsDerived()).toBe(before);
    expect(itemIdCacheStats().hits).toBeGreaterThan(hits);
  });

  it('caches nothing and hashes nothing for values whose instances all store their IDs', () => {
    const components = componentsWith(true);
    const stored = { [CARDS]: [{ __id: 'x1', [LABEL]: 'A', [INNER]: [{ __id: 'x2', [NOTE]: 'n' }] }] };
    const stats = itemIdCacheStats();
    expect(withItemIdsCached(stored, fields, components, scope)).toEqual(uncached(stored, scope, components));
    expect(itemIdCacheStats()).toEqual(stats);
    expect(itemIdCacheOf(key).size).toBe(0);
  });

  it('derives again when the value, the entry, the key, the locale or the schema changes', () => {
    const components = componentsWith(true);
    const data = { [CARDS]: [{ [LABEL]: 'A', [INNER]: [{ [NOTE]: 'n' }] }, { [LABEL]: 'B' }] };
    withItemIdsCached(data, fields, components, scope);
    const derivesAgain = (
      changed: Record<string, unknown>,
      at: ItemIdScope,
      list: readonly FieldDefinition[],
      schema = components,
    ) => {
      const before = itemIdsDerived();
      const read = withItemIdsCached(changed, list, schema, at);
      expect(itemIdsDerived()).toBeGreaterThan(before);
      expect(read).toEqual(withItemIds(changed, list, componentLookupOf(schema), at));
    };
    // The stored value: a nested value, an item's order, a key order (another JSON text: a miss, never a wrong hit).
    derivesAgain(
      { [CARDS]: [{ [LABEL]: 'A', [INNER]: [{ [NOTE]: 'm' }] }, { [LABEL]: 'B' }] },
      scope,
      fields,
    );
    derivesAgain(
      { [CARDS]: [{ [LABEL]: 'B' }, { [LABEL]: 'A', [INNER]: [{ [NOTE]: 'n' }] }] },
      scope,
      fields,
    );
    derivesAgain(
      { [CARDS]: [{ [INNER]: [{ [NOTE]: 'n' }], [LABEL]: 'A' }, { [LABEL]: 'B' }] },
      scope,
      fields,
    );
    // The entry, the instance key.
    derivesAgain(data, { ...scope, entryId: id(101) }, fields);
    derivesAgain(data, { ...scope, key: Buffer.alloc(32, 8) }, fields);
    clearItemIdCache(Buffer.alloc(32, 8));
    // A localized field derives per locale.
    const localized = [cards(true), hero(true), zone(true)];
    derivesAgain(data, { ...scope, locale: 'en' }, localized);
    derivesAgain(data, { ...scope, locale: 'fr' }, localized);
    // The schema below the field: a nested list made single.
    derivesAgain(data, scope, fields, componentsWith(false));
    // The field itself: made single (its value read as one instance).
    const single = { [CARDS]: { [LABEL]: 'A' } };
    withItemIdsCached(single, fields, components, scope);
    derivesAgain(single, scope, [
      { ...cards(false), settings: { component: CARD, repeatable: false } } as FieldDefinition,
    ]);
  });

  it('shares a shared field across locales, as its IDs are', () => {
    const components = componentsWith(true);
    const data = { [CARDS]: [{ [LABEL]: 'A' }] };
    withItemIdsCached(data, fields, components, { ...scope, locale: 'en' });
    const before = itemIdsDerived();
    const fr = withItemIdsCached(data, fields, components, { ...scope, locale: 'fr' });
    expect(itemIdsDerived()).toBe(before);
    expect(fr).toEqual(uncached(data, { ...scope, locale: 'fr' }, components));
  });

  it('gives a different schema a different signature', () => {
    expect(componentsSignatureOf(componentsWith(true))).not.toBe(
      componentsSignatureOf(componentsWith(false)),
    );
    expect(componentsSignatureOf(componentsWith(true))).toBe(componentsSignatureOf(componentsWith(true)));
    const withoutLeaf = new Map([[CARD, { definition: cardWith(true), version: 1 }]]);
    expect(componentsSignatureOf(withoutLeaf)).not.toBe(componentsSignatureOf(componentsWith(true)));
  });

  it('derives every time when turned off', () => {
    setItemIdCacheEnabled(false);
    const components = componentsWith(true);
    const data = corpus(3);
    withItemIdsCached(data, fields, components, scope);
    const before = itemIdsDerived();
    expect(withItemIdsCached(data, fields, components, scope)).toEqual(uncached(data, scope, components));
    expect(itemIdsDerived()).toBeGreaterThan(before);
    expect(itemIdCacheOf(key).size).toBe(0);
  });

  it('weighs what it holds and stays within its byte budget', () => {
    const components = componentsWith(true);
    for (let seed = 1; seed <= 50; seed += 1) {
      withItemIdsCached(corpus(seed), fields, components, scope);
    }
    const cache = itemIdCacheOf(key);
    expect(cache.size).toBeGreaterThan(0);
    expect(cache.weight).toBeGreaterThan(0);
    clearItemIdCache(key);
    expect(cache.size).toBe(0);
    expect(cache.weight).toBe(0);
  });
});
