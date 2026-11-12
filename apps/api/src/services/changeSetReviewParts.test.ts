import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldDiff } from './changeSetReviewParts.js';

const field = (id: string, type: string, settings: Record<string, unknown> = {}) =>
  ({ id, apiKey: id, label: id, type, settings }) as unknown as FieldDefinition;

const link = { id: 'c-link', kind: 'component', fields: [field('text', 'string')] };
const card = {
  id: 'c-card',
  kind: 'component',
  fields: [field('title', 'string'), field('links', 'component', { component: 'c-link', repeatable: true })],
};
const componentOf = (id: string) => [link, card].find((c) => c.id === id) as ComponentDefinition | undefined;

const fields = [
  field('cards', 'component', { component: 'c-card', repeatable: true }),
  field('zone', 'dynamiczone', { components: ['c-link'] }),
  field('extra', 'json'),
];

describe('fieldDiff', () => {
  it('does not count an item ID as a change (an item that only gained its persisted ID is unchanged)', () => {
    const before = {
      cards: [{ title: 'A', links: [{ text: 'x' }] }],
      zone: [{ __component: 'c-link', text: 'y' }],
      extra: { a: 1 },
    };
    const after = {
      cards: [{ __id: 'i-1', title: 'A', links: [{ __id: 'i-2', text: 'x' }] }],
      zone: [{ __component: 'c-link', __id: 'i-3', text: 'y' }],
      extra: { a: 1 },
    };
    expect(fieldDiff(fields, before, after, componentOf)).toEqual([]);
  });

  it('still reports content changes, with the values as stored (IDs included)', () => {
    const before = {
      cards: [
        { __id: 'i-1', title: 'A' },
        { __id: 'i-2', title: 'B' },
      ],
    };
    const after = {
      cards: [
        { __id: 'i-2', title: 'B' },
        { __id: 'i-1', title: 'A' },
      ],
    };
    expect(fieldDiff(fields, before, after, componentOf)).toEqual([
      { field: fields[0], before: before.cards, after: after.cards },
    ]);
    // A json field's own `__id` is content.
    expect(fieldDiff(fields, { extra: { __id: 1 } }, { extra: { __id: 2 } }, componentOf)).toHaveLength(1);
  });
});
