import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { buildPatch, dirtyKeysOf, mergeSaved, newComponentItem, toFormValues } from './formValues';
import { asNewItem, asNewItems, savedItemIds, withItemIds, withoutItemIds } from './itemIds';
import { CLIENT_KEY, ITEM_ID_KEY, isSameContent, type FormValues, type ItemValues } from './values';

const link = component({ apiKey: 'link', label: 'Link', fields: [field({ apiKey: 'label' })] });
const card = component({
  apiKey: 'card',
  label: 'Card',
  fields: [
    field({ apiKey: 'title' }),
    field({ apiKey: 'links', type: 'component', settings: { component: link.id, repeatable: true } }),
  ],
});
const page = model({
  fields: [
    field({ apiKey: 'cards', type: 'component', settings: { component: card.id, repeatable: true } }),
    field({ apiKey: 'hero', type: 'component', settings: { component: link.id } }),
    field({ apiKey: 'sections', type: 'dynamiczone', settings: { components: [card.id, link.id] } }),
    field({ apiKey: 'meta', type: 'json' }),
  ],
});
const components = new Map([
  [card.id, card],
  [link.id, link],
]);

const loaded = () =>
  toFormValues(
    page.fields,
    {
      cards: [
        { id: 'c1', title: 'One', links: [{ id: 'l1', label: 'a' }] },
        { id: 'c2', title: 'Two', links: null },
      ],
      hero: { id: 'h1', label: 'Hi' },
      sections: [{ __component: 'link', id: 's1', label: 'x' }],
      meta: { id: 'not an item' },
    },
    components,
  );

const items = (value: unknown) => value as ItemValues[];

describe('item IDs in form values', () => {
  it('keeps every item ID (single, repeatable, nested, zone) and keys saved items by it', () => {
    const values = loaded();
    const [first] = items(values.cards);
    expect(first).toMatchObject({ [ITEM_ID_KEY]: 'c1', [CLIENT_KEY]: 'c1' });
    expect(items(first?.links)[0]).toMatchObject({ [ITEM_ID_KEY]: 'l1', [CLIENT_KEY]: 'l1' });
    expect(values.hero).toMatchObject({ [ITEM_ID_KEY]: 'h1' });
    expect(items(values.sections)[0]).toMatchObject({ __component: 'link', [ITEM_ID_KEY]: 's1' });
  });

  it('sends the IDs back, and leaves them out for new items', () => {
    const values = loaded();
    const next = { ...values, cards: [...items(values.cards), newComponentItem(card, false)] };
    const patch = buildPatch(next, dirtyKeysOf(next, values));
    expect(patch).toEqual({
      cards: [
        { id: 'c1', title: 'One', links: [{ id: 'l1', label: 'a' }] },
        { id: 'c2', title: 'Two', links: null },
        { title: null, links: null },
      ],
    });
  });

  it('makes a duplicate a new item: no IDs and fresh client keys, nested items included', () => {
    const first = items(loaded().cards)[0] ?? {};
    const copy = asNewItem(first);
    expect(copy).not.toHaveProperty(ITEM_ID_KEY);
    expect(copy[CLIENT_KEY]).not.toBe(first[CLIENT_KEY]);
    const [nested] = items(copy.links);
    expect(nested).not.toHaveProperty(ITEM_ID_KEY);
    expect(nested?.[CLIENT_KEY]).not.toBe('l1');
    expect(nested?.label).toBe('a');
  });

  it('copies another locale as new items without touching non-component values', () => {
    const values = loaded();
    const copied = asNewItems(values);
    expect(items(copied.cards).every((item) => !(ITEM_ID_KEY in item))).toBe(true);
    expect(copied.meta).toEqual({ id: 'not an item' });
  });

  it('compares content without IDs only when asked to', () => {
    const values = loaded();
    const other = asNewItems(values);
    expect(dirtyKeysOf(other, values).sort()).toEqual(['cards', 'hero', 'sections']);
    expect(isSameContent(withoutItemIds(other.cards), withoutItemIds(values.cards))).toBe(true);
  });
});

describe('IDs from a save', () => {
  it('gives new items (nested ones too) the saved IDs, keeping client keys, and leaves the form clean', () => {
    const baseline = loaded();
    const added = newComponentItem(card, false);
    const nestedNew = newComponentItem(link, false);
    const [first, second] = items(baseline.cards);
    const sent: FormValues = {
      ...baseline,
      cards: [{ ...first, links: [...items(first?.links), nestedNew] }, second, { ...added, title: 'Three' }],
    };
    const saved = toFormValues(
      page.fields,
      {
        cards: [
          {
            id: 'c1',
            title: 'One',
            links: [
              { id: 'l1', label: 'a' },
              { id: 'l2', label: null },
            ],
          },
          { id: 'c2', title: 'Two', links: null },
          { id: 'c3', title: 'Three', links: null },
        ],
        hero: { id: 'h1', label: 'Hi' },
        sections: [{ __component: 'link', id: 's1', label: 'x' }],
        meta: { id: 'not an item' },
      },
      components,
    );
    const merged = mergeSaved(sent, sent, saved);
    const cards = items(merged.values.cards);
    expect(cards[2]).toMatchObject({ [ITEM_ID_KEY]: 'c3', [CLIENT_KEY]: added[CLIENT_KEY] });
    expect(items(cards[0]?.links)[1]).toMatchObject({
      [ITEM_ID_KEY]: 'l2',
      [CLIENT_KEY]: nestedNew[CLIENT_KEY],
    });
    expect(merged.values.hero).toBe(sent.hero);
    expect(dirtyKeysOf(merged.values, merged.baseline)).toEqual([]);
  });

  it('gives IDs to new items of a field edited while the save was in flight', () => {
    const added = newComponentItem(link, false);
    const sent = { cards: [], sections: [added] };
    const current = { cards: [], sections: [{ ...added, label: 'typed meanwhile' }] };
    const saved = { cards: [], sections: [{ ...added, [ITEM_ID_KEY]: 's9', [CLIENT_KEY]: 's9' }] };
    const merged = mergeSaved(current, sent, saved);
    expect(items(merged.values.sections)[0]).toMatchObject({
      [ITEM_ID_KEY]: 's9',
      [CLIENT_KEY]: added[CLIENT_KEY],
      label: 'typed meanwhile',
    });
    expect(dirtyKeysOf(merged.values, merged.baseline)).toEqual(['sections']);
  });

  it('pairs nothing when the saved list has another length or a different component', () => {
    const a = newComponentItem(link, true);
    expect(savedItemIds([a], [])).toEqual(new Map());
    expect(savedItemIds([a], [{ __component: 'card', id: 'x' }])).toEqual(new Map());
    const unchanged = [a];
    expect(withItemIds(unchanged, new Map([['other', 'x']]))).toBe(unchanged);
  });
});
