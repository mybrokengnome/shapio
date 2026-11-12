import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldsWithoutItemIds, valueWithoutItemIds } from './withoutItemIds.js';

const field = (id: string, type: string, settings: Record<string, unknown> = {}) =>
  ({ id, apiKey: id, label: id, type, settings }) as unknown as FieldDefinition;

const inner = { id: 'c-inner', kind: 'component', fields: [field('text', 'string')] };
const outer = {
  id: 'c-outer',
  kind: 'component',
  fields: [field('title', 'string'), field('links', 'component', { component: 'c-inner', repeatable: true })],
};
const componentOf = (id: string) =>
  [inner, outer].find((c) => c.id === id) as ComponentDefinition | undefined;

const fields = [
  field('hero', 'component', { component: 'c-outer' }),
  field('zone', 'dynamiczone', { components: ['c-outer', 'c-inner'] }),
  field('extra', 'json'),
];

describe('withoutItemIds', () => {
  it('removes the ID of every component instance, at any depth, and nothing else', () => {
    const data = {
      hero: { __id: 'h', title: 'T', links: [{ __id: 'l1', text: 'a' }] },
      zone: [
        { __component: 'c-outer', __id: 'z1', title: 'Z', links: [{ __id: 'l2', text: 'b' }] },
        { __component: 'c-inner', __id: 'z2', text: 'c' },
      ],
      extra: { __id: 'mine' },
    };
    expect(fieldsWithoutItemIds(fields, data, componentOf)).toEqual({
      hero: { title: 'T', links: [{ text: 'a' }] },
      zone: [
        { __component: 'c-outer', title: 'Z', links: [{ text: 'b' }] },
        { __component: 'c-inner', text: 'c' },
      ],
      // A json field's own `__id` is content.
      extra: { __id: 'mine' },
    });
    // The input is untouched.
    expect(data.hero.__id).toBe('h');
  });

  it('leaves values that do not match their field as they are', () => {
    expect(valueWithoutItemIds(fields[0] as FieldDefinition, 'text', componentOf)).toBe('text');
    expect(valueWithoutItemIds(fields[1] as FieldDefinition, null, componentOf)).toBeNull();
    expect(
      valueWithoutItemIds(fields[1] as FieldDefinition, [{ __component: 'gone', __id: 'x' }], componentOf),
    ).toEqual([{ __component: 'gone' }]);
  });
});
