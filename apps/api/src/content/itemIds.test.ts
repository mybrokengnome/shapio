import { normalizeDefinition, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { assignItemIds, transferItemIds, withItemIds } from './itemIds.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CARD = id(1);
const LABEL = id(2);
const NOTE = id(3);
const CARDS = id(4);
const HERO = id(5);
const INNER = id(6);

const card = normalizeDefinition({
  id: CARD,
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [
    { id: LABEL, apiKey: 'label', label: 'Label', type: 'string' },
    { id: NOTE, apiKey: 'note', label: 'Note', type: 'string', public: false },
    {
      id: INNER,
      apiKey: 'inner',
      label: 'Inner',
      type: 'component',
      settings: { component: CARD, repeatable: true },
    },
  ],
}) as ComponentDefinition;

const field = (fieldId: string, repeatable: boolean) =>
  ({
    id: fieldId,
    apiKey: fieldId === CARDS ? 'cards' : 'hero',
    label: 'x',
    type: 'component',
    required: false,
    localized: false,
    public: true,
    unique: false,
    filterable: false,
    sortable: false,
    deprecated: false,
    editor: { id: 'component', options: {} },
    settings: { component: CARD, repeatable },
  }) as FieldDefinition;

const fields = [field(CARDS, true), field(HERO, false)];
const componentOf = (componentId: string) => (componentId === CARD ? card : undefined);
const key = Buffer.alloc(32, 7);
const scope = { key, entryId: id(100) };

type Items = Array<Record<string, unknown>>;
const idsOf = (data: Record<string, unknown>) => (data[CARDS] as Items).map((item) => item.__id);

describe('withItemIds', () => {
  const stored = {
    [CARDS]: [
      { [LABEL]: 'A', [NOTE]: 'nA' },
      { [LABEL]: 'B', [NOTE]: 'nB' },
      { [LABEL]: 'A', [NOTE]: 'nA' },
    ],
    [HERO]: { [LABEL]: 'h' },
  };

  it('derives an ID for every instance stored without one, the same on every read', () => {
    const read = withItemIds(stored, fields, componentOf, scope);
    const ids = idsOf(read);
    expect(ids.every((value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value))).toBe(true);
    // Identical items get distinct IDs (in order); the single instance has one too.
    expect(new Set(ids).size).toBe(3);
    expect((read[HERO] as Record<string, unknown>).__id).toEqual(expect.any(String));
    expect(withItemIds(stored, fields, componentOf, scope)).toEqual(read);
  });

  it('follows an unchanged item wherever it stands (draft and published, reorders)', () => {
    const [a, b] = idsOf(withItemIds(stored, fields, componentOf, scope));
    const reordered = {
      [CARDS]: [{ [LABEL]: 'B', [NOTE]: 'nB' }, { [LABEL]: 'C' }, { [LABEL]: 'A', [NOTE]: 'nA' }],
    };
    const ids = idsOf(withItemIds(reordered, fields, componentOf, scope));
    expect(ids[0]).toBe(b);
    expect(ids[2]).toBe(a);
  });

  it('needs the instance key: another key, another entry or another content gives other IDs', () => {
    const ids = idsOf(withItemIds(stored, fields, componentOf, scope));
    expect(
      idsOf(withItemIds(stored, fields, componentOf, { ...scope, key: Buffer.alloc(32, 8) })),
    ).not.toEqual(ids);
    expect(idsOf(withItemIds(stored, fields, componentOf, { ...scope, entryId: id(101) }))).not.toEqual(ids);
    // A hidden value is part of what an ID is derived from, through the key: never testable without it.
    const edited = { [CARDS]: [{ [LABEL]: 'A', [NOTE]: 'other' }] };
    expect(idsOf(withItemIds(edited, fields, componentOf, scope))[0]).not.toBe(ids[0]);
  });

  it('keeps a stored ID and derives nested items under their parent', () => {
    const nested = { [CARDS]: [{ __id: 'kept', [LABEL]: 'A', [INNER]: [{ [LABEL]: 'x' }] }] };
    const read = withItemIds(nested, fields, componentOf, scope);
    const [item] = read[CARDS] as Items;
    expect(item?.__id).toBe('kept');
    expect(((item?.[INNER] as Items)[0] as Record<string, unknown>).__id).toEqual(expect.any(String));
  });
});

describe('withItemIds on a localized content type', () => {
  const localizedHero = { ...field(HERO, false), localized: true } as FieldDefinition;
  const sharedCards = { ...field(CARDS, true), localized: false } as FieldDefinition;
  const both = [sharedCards, localizedHero];
  const data = { [CARDS]: [{ [LABEL]: 'A' }], [HERO]: { [LABEL]: 'h' } };
  const read = (locale: string) => withItemIds(data, both, componentOf, { ...scope, locale });

  it('derives a localized field per locale, a shared one alike in every locale', () => {
    const en = read('en');
    const fr = read('fr');
    expect((en[HERO] as Record<string, unknown>).__id).not.toBe((fr[HERO] as Record<string, unknown>).__id);
    expect(idsOf(en)).toEqual(idsOf(fr));
    // The same locale reads the same IDs (a draft and its published version).
    expect(read('en')).toEqual(en);
  });
});

describe('assignItemIds', () => {
  it('gives instances without an ID a new one and keeps the others', () => {
    const data = assignItemIds(
      { [CARDS]: [{ __id: 'a', [LABEL]: 'A' }, { [LABEL]: 'B' }] },
      fields,
      componentOf,
    );
    expect(idsOf(data)[0]).toBe('a');
    expect(idsOf(data)[1]).toEqual(expect.any(String));
  });

  it('renews every ID consistently (a copy: the same item in every locale gets the same new ID)', () => {
    const renew = new Map<string, string>();
    const en = assignItemIds({ [CARDS]: [{ __id: 'a' }, { __id: 'b' }] }, fields, componentOf, { renew });
    const fr = assignItemIds({ [CARDS]: [{ __id: 'b' }] }, fields, componentOf, { renew });
    expect(idsOf(en)).not.toContain('a');
    expect(idsOf(fr)[0]).toBe(idsOf(en)[1]);
  });
});

describe('transferItemIds', () => {
  it('persists the IDs items read with before a conversion, place by place', () => {
    const before = withItemIds(
      { [CARDS]: [{ [LABEL]: 'A' }, { [LABEL]: 'B' }], [HERO]: { [LABEL]: 'h' } },
      fields,
      componentOf,
      scope,
    );
    const converted = { [CARDS]: [{ [LABEL]: 'A!' }, { [LABEL]: 'B!' }], [HERO]: { [LABEL]: 'h!' } };
    const after = transferItemIds(before, converted, fields, componentOf);
    expect(idsOf(after)).toEqual(idsOf(before));
    expect((after[HERO] as Record<string, unknown>).__id).toBe(
      (before[HERO] as Record<string, unknown>).__id,
    );
  });
});
