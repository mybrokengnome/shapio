import type { FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { isSortableField, operatorsFor, toContentFilter } from './filterOperators';

const fieldsOf = (fields: Parameters<typeof field>[0][]) => model({ fields: fields.map(field) }).fields;

describe('operatorsFor', () => {
  const [title, indexedTitle, rating, tags, author] = fieldsOf([
    { apiKey: 'title', label: 'Title', type: 'string' },
    { apiKey: 'slug', label: 'Slug', type: 'string', filterable: true },
    { apiKey: 'rating', label: 'Rating', type: 'integer', sortable: true },
    {
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: { values: [{ value: 'a', label: 'A' }], multiple: true },
    },
    { apiKey: 'author', label: 'Author', type: 'relation', settings: { target: 'x', cardinality: 'one' } },
  ]);

  it('offers equality everywhere, ranges and text matches only where an index allows them', () => {
    expect(operatorsFor(title as FieldDefinition)).toEqual([
      '$eq',
      '$ne',
      '$in',
      '$nin',
      '$null',
      '$notNull',
    ]);
    expect(operatorsFor(indexedTitle as FieldDefinition)).toContain('$containsi');
    expect(operatorsFor(rating as FieldDefinition)).toContain('$gte');
    expect(operatorsFor(rating as FieldDefinition)).not.toContain('$containsi');
    expect(operatorsFor(tags as FieldDefinition)).toEqual(['$eq', '$ne', '$in', '$nin', '$null', '$notNull']);
    expect(operatorsFor(author as FieldDefinition)).toContain('$eq');
  });

  it('sorts only sortable scalars', () => {
    expect(isSortableField(rating as FieldDefinition)).toBe(true);
    expect(isSortableField(title as FieldDefinition)).toBe(false);
  });
});

describe('toContentFilter', () => {
  it('builds one condition, or $and of several', () => {
    expect(toContentFilter([])).toBeUndefined();
    expect(toContentFilter([{ field: 'title', operator: '$containsi', value: 'sale' }])).toEqual({
      title: { $containsi: 'sale' },
    });
    expect(
      toContentFilter([
        { field: 'rating', operator: '$gte', value: '3' },
        { field: 'tags', operator: '$in', value: 'a, b' },
        { field: 'summary', operator: '$null' },
      ]),
    ).toEqual({
      $and: [{ rating: { $gte: '3' } }, { tags: { $in: ['a', 'b'] } }, { summary: { $null: true } }],
    });
  });
});
