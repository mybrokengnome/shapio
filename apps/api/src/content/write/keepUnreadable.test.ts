import { normalizeDefinition, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../helpers/appError.js';
import { assertComponentListCaps, keepUnreadableComponentFields } from './keepUnreadable.js';
import { CARRY_MAX_ITEMS } from './listPairing.js';

/** Stored data without item IDs (`__id`, at any depth): the tests compare content. */
const noIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(noIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([key, item]) => [key, noIds(item)]),
        )
      : value;

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CARD = id(1);
const LABEL = id(2);
const NOTE = id(3);
const CARDS = id(4);

const card = normalizeDefinition({
  id: CARD,
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [
    { id: LABEL, apiKey: 'label', label: 'Label', type: 'string' },
    { id: NOTE, apiKey: 'note', label: 'Note', type: 'string', public: false },
  ],
}) as ComponentDefinition;

const cardsField = (max?: number) =>
  ({
    id: CARDS,
    apiKey: 'cards',
    label: 'Cards',
    type: 'component',
    required: false,
    localized: false,
    public: true,
    unique: false,
    filterable: false,
    sortable: false,
    deprecated: false,
    editor: { id: 'component', options: {} },
    settings: { component: CARD, repeatable: true, ...(max === undefined ? {} : { max }) },
  }) as FieldDefinition;

const componentOf = (componentId: string) => (componentId === CARD ? card : undefined);

const keep = (patch: Record<string, unknown>, before: Record<string, unknown>, mayRead = true) =>
  noIds(
    keepUnreadableComponentFields(patch, before, [cardsField()], componentOf, (field) => field.public, {
      mayRead,
    }),
  ) as Record<string, unknown>;

const assertCaps = (patch: Record<string, unknown>, max?: number) =>
  assertComponentListCaps(patch, [cardsField(max)], componentOf);

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof AppError
      ? [error.code, (error.details as { issues: unknown[] }).issues]
      : String(error);
  }
  return 'none';
};

describe('keepUnreadableComponentFields', () => {
  it('matches a large list of identical items in linear time', () => {
    const count = CARRY_MAX_ITEMS;
    const before = {
      [CARDS]: Array.from({ length: count }, (_, index) => ({ [LABEL]: 'same', [NOTE]: `n${index}` })),
    };
    const patch = { [CARDS]: Array.from({ length: count }, () => ({ [LABEL]: 'same' })) };
    const started = performance.now();
    const kept = keep(patch, before);
    const elapsed = performance.now() - started;
    // Equal items are taken in stored order: each keeps its own hidden value.
    expect((kept[CARDS] as Array<Record<string, unknown>>)[count - 1]).toEqual({
      [LABEL]: 'same',
      [NOTE]: `n${count - 1}`,
    });
    // Quadratic matching took minutes here; linear takes well under a second (generous for slow machines).
    expect(elapsed).toBeLessThan(5_000);
  });

  it('refuses a list longer than it considers with the validator’s own TOO_MANY, checked with the body', () => {
    const tooMany = { [CARDS]: Array.from({ length: CARRY_MAX_ITEMS + 1 }, () => ({ [LABEL]: 'x' })) };
    expect(codeOf(() => assertCaps(tooMany))).toEqual([
      'CONTENT_INVALID',
      [{ path: '/cards', code: 'TOO_MANY', message: `allows at most ${CARRY_MAX_ITEMS} item(s)` }],
    ]);
    // The field's own `max` when it is lower.
    const four = { [CARDS]: Array.from({ length: 4 }, () => ({ [LABEL]: 'x' })) };
    expect(codeOf(() => assertCaps(four, 3))).toEqual([
      'CONTENT_INVALID',
      [{ path: '/cards', code: 'TOO_MANY', message: 'allows at most 3 item(s)' }],
    ]);
    expect(codeOf(() => assertCaps(four, 4))).toBe('none');
  });

  it('pairs two large items by content when they swap, whatever their size', () => {
    // Items far past any per-item key limit (a long rich-text-like document): swapped, each keeps its own
    // hidden value, also when the list kept its length (no in-place fallback takes over).
    const big = (letter: string) => letter.repeat(200_000);
    const before = {
      [CARDS]: [
        { [LABEL]: big('a'), [NOTE]: 'nA' },
        { [LABEL]: big('b'), [NOTE]: 'nB' },
      ],
    };
    expect(keep({ [CARDS]: [{ [LABEL]: big('b') }, { [LABEL]: big('a') }] }, before)).toEqual({
      [CARDS]: [
        { [LABEL]: big('b'), [NOTE]: 'nB' },
        { [LABEL]: big('a'), [NOTE]: 'nA' },
      ],
    });
  });

  it('for a caller that may not read, keeps only what it cannot write: what it leaves out is cleared', () => {
    const before = { [CARDS]: [{ [LABEL]: 'A', [NOTE]: 'nA' }] };
    // `note` is private but writable: a write-only caller that leaves it out clears it, as on any content type.
    expect(keep({ [CARDS]: [{ [LABEL]: 'A' }] }, before, false)).toEqual({ [CARDS]: [{ [LABEL]: 'A' }] });
    // A reader that cannot read it keeps it.
    expect(keep({ [CARDS]: [{ [LABEL]: 'A' }] }, before, true)).toEqual({
      [CARDS]: [{ [LABEL]: 'A', [NOTE]: 'nA' }],
    });
  });

  it('follows deletes and reorders of distinct items, and refuses a delete with an add', () => {
    const before = {
      [CARDS]: [
        { [LABEL]: 'A', [NOTE]: 'nA' },
        { [LABEL]: 'B', [NOTE]: 'nB' },
      ],
    };
    expect(keep({ [CARDS]: [{ [LABEL]: 'B' }] }, before)).toEqual({
      [CARDS]: [{ [LABEL]: 'B', [NOTE]: 'nB' }],
    });
    expect(keep({ [CARDS]: [{ [LABEL]: 'B' }, { [LABEL]: 'A' }] }, before)).toEqual({
      [CARDS]: [
        { [LABEL]: 'B', [NOTE]: 'nB' },
        { [LABEL]: 'A', [NOTE]: 'nA' },
      ],
    });
    // A stored item deleted and new ones added in one write, without IDs: refused (never guess).
    expect(
      codeOf(() => keep({ [CARDS]: [{ [LABEL]: 'B' }, { [LABEL]: 'A2' }, { [LABEL]: 'C' }] }, before)),
    ).toEqual(['CONTENT_INVALID', [expect.objectContaining({ path: '/cards', code: 'AMBIGUOUS_ITEMS' })]]);
  });
});
