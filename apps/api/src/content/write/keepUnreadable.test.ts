import { normalizeDefinition, type ComponentDefinition, type FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../helpers/appError.js';
import { CARRY_MAX_ITEMS, keepUnreadableComponentFields } from './keepUnreadable.js';

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

const keep = (patch: Record<string, unknown>, before: Record<string, unknown>, max?: number) =>
  keepUnreadableComponentFields(
    patch,
    before,
    [cardsField(max)],
    (componentId) => (componentId === CARD ? card : undefined),
    (field) => field.public,
  );

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

  it('refuses a list longer than it considers with the validator’s own TOO_MANY, before matching', () => {
    const tooMany = { [CARDS]: Array.from({ length: CARRY_MAX_ITEMS + 1 }, () => ({ [LABEL]: 'x' })) };
    expect(codeOf(() => keep(tooMany, {}))).toEqual([
      'CONTENT_INVALID',
      [{ path: '/cards', code: 'TOO_MANY', message: `allows at most ${CARRY_MAX_ITEMS} item(s)` }],
    ]);
    // The field's own `max` when it is lower.
    const four = { [CARDS]: Array.from({ length: 4 }, () => ({ [LABEL]: 'x' })) };
    expect(codeOf(() => keep(four, {}, 3))).toEqual([
      'CONTENT_INVALID',
      [{ path: '/cards', code: 'TOO_MANY', message: 'allows at most 3 item(s)' }],
    ]);
  });

  it('follows deletes and reorders by what the caller sees, and drops a hidden value for a new item', () => {
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
    expect(keep({ [CARDS]: [{ [LABEL]: 'B' }, { [LABEL]: 'A2' }, { [LABEL]: 'C' }] }, before)).toEqual({
      [CARDS]: [{ [LABEL]: 'B', [NOTE]: 'nB' }, { [LABEL]: 'A2' }, { [LABEL]: 'C' }],
    });
  });
});
