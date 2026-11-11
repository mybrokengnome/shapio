import { normalizeDefinition, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { ITEM_ID_PATTERN } from '../../constants/itemIds.js';
import { withUniqueItemIds } from './itemIdUniqueness.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CARD = id(1);
const LABEL = id(2);
const INNER = id(3);
const CARDS = id(4);
const HERO = id(5);

const card = normalizeDefinition({
  id: CARD,
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [
    { id: LABEL, apiKey: 'label', label: 'Label', type: 'string' },
    { id: INNER, apiKey: 'inner', label: 'Inner', type: 'json' },
  ],
}) as ComponentDefinition;

const field = (fieldId: string, repeatable: boolean, localized: boolean) =>
  ({
    id: fieldId,
    apiKey: fieldId === CARDS ? 'cards' : 'hero',
    label: 'x',
    type: 'component',
    required: false,
    localized,
    public: true,
    unique: false,
    filterable: false,
    sortable: false,
    deprecated: false,
    editor: { id: 'component', options: {} },
    settings: { component: CARD, repeatable },
  }) as FieldDefinition;

const componentOf = (componentId: string) => (componentId === CARD ? card : undefined);
type Item = Record<string, unknown>;

describe('withUniqueItemIds', () => {
  const fields = [field(CARDS, true, false), field(HERO, false, false)];

  it('returns the data itself when every ID is unique', () => {
    const data = { [CARDS]: [{ __id: 'a' }, { __id: 'b' }], [HERO]: { __id: 'c' } };
    expect(withUniqueItemIds(data, fields, componentOf)).toBe(data);
  });

  it('keeps the first instance of an ID and renews the later ones, the same way every time', () => {
    const data = {
      [CARDS]: [
        { __id: 'a', [LABEL]: '1' },
        { __id: 'a', [LABEL]: '2' },
      ],
      [HERO]: { __id: 'a' },
    };
    const unique = withUniqueItemIds(data, fields, componentOf);
    const cards = unique[CARDS] as Item[];
    const ids = [cards[0]?.__id, cards[1]?.__id, (unique[HERO] as Item).__id];
    expect(ids[0]).toBe('a');
    expect(new Set(ids).size).toBe(3);
    expect(ids.slice(1).every((value) => ITEM_ID_PATTERN.test(String(value)))).toBe(true);
    expect(cards[1]?.[LABEL]).toBe('2');
    expect(withUniqueItemIds(data, fields, componentOf)).toEqual(unique);
    // The input is left as it was.
    expect((data[CARDS] as Item[])[1]?.__id).toBe('a');
  });

  it('keeps a shared field instance over a localized repeat, so every locale renews alike', () => {
    const both = [field(HERO, false, true), field(CARDS, true, false)];
    const unique = withUniqueItemIds({ [HERO]: { __id: 'a' }, [CARDS]: [{ __id: 'a' }] }, both, componentOf);
    expect((unique[CARDS] as Item[])[0]?.__id).toBe('a');
    expect((unique[HERO] as Item).__id).not.toBe('a');
  });

  it('walks items holding a json value 3,000 levels deep', () => {
    let deep: unknown = 1;
    for (let level = 0; level < 3000; level += 1) {
      deep = [deep];
    }
    const unique = withUniqueItemIds(
      {
        [CARDS]: [
          { __id: 'a', [INNER]: deep },
          { __id: 'a', [INNER]: deep },
        ],
      },
      fields,
      componentOf,
    );
    expect(new Set((unique[CARDS] as Item[]).map((item) => item.__id)).size).toBe(2);
  });
});
