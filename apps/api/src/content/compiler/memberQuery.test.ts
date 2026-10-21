import type { FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { memberQuery } from './memberQuery.js';
import type { ContentQuery } from './types.js';

const field = (id: string, apiKey: string, type = 'string') =>
  ({ id, apiKey, type, sortable: true, filterable: true }) as unknown as FieldDefinition;

const contractTitle = field('c-title', 'title');
const contractImage = field('c-image', 'image', 'media');
const contractAuthor = field('c-author', 'author', 'relation');
const contract = [contractTitle, contractImage, contractAuthor];
const member: Record<string, FieldDefinition> = {
  title: field('m-title', 'title'),
  image: field('m-image', 'image', 'media'),
  author: field('m-author', 'author', 'relation'),
};
const fieldFor = (contractField: FieldDefinition) => member[contractField.apiKey];

const query: ContentQuery = {
  filter: {
    kind: 'and',
    nodes: [
      {
        kind: 'condition',
        target: { kind: 'field', field: contractTitle },
        operator: '$contains',
        value: 'web',
      },
      {
        kind: 'not',
        node: {
          kind: 'condition',
          target: { kind: 'system', name: 'createdAt' },
          operator: '$gt',
          value: 'x',
        },
      },
    ],
  },
  search: { field: contractTitle, text: 'sign' },
  sort: [
    { target: { kind: 'field', field: contractTitle }, direction: 'asc' },
    { target: { kind: 'system', name: 'id' }, direction: 'desc' },
  ],
  page: 2,
  pageSize: 10,
  fields: [contractTitle, contractImage],
  populate: new Map([['c-author', new Map([['nested', new Map()]])]]),
  locale: 'en',
  snapshot: undefined,
};

describe('memberQuery', () => {
  it("names the member's own fields wherever the query names a contract field", () => {
    const rewritten = memberQuery(query, contract, fieldFor);
    expect(rewritten.filter).toEqual({
      kind: 'and',
      nodes: [
        {
          kind: 'condition',
          target: { kind: 'field', field: member.title },
          operator: '$contains',
          value: 'web',
        },
        query.filter?.kind === 'and' ? query.filter.nodes[1] : null,
      ],
    });
    expect(rewritten.search).toEqual({ field: member.title, text: 'sign' });
    expect(rewritten.sort).toEqual([
      { target: { kind: 'field', field: member.title }, direction: 'asc' },
      { target: { kind: 'system', name: 'id' }, direction: 'desc' },
    ]);
    expect(rewritten.fields).toEqual([member.title, member.image]);
    // Below a relation the target's own field IDs stay: the contract fixes the relation's target.
    expect(rewritten.populate).toEqual(new Map([['m-author', new Map([['nested', new Map()]])]]));
    expect(rewritten).toMatchObject({ page: 2, pageSize: 10, locale: 'en' });
  });

  it('keeps an empty query empty', () => {
    const empty = { ...query, filter: null, search: null, sort: [], fields: null, populate: new Map() };
    expect(memberQuery(empty, contract, fieldFor)).toEqual(empty);
  });

  it('throws when a member has no field for the contract field (a bug, never a user error)', () => {
    expect(() => memberQuery(query, contract, () => undefined)).toThrow(/contract field "title"/);
  });
});
