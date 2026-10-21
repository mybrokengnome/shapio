import { describe, expect, it } from 'vitest';
import { createDefinitionIndex } from '../inheritance/resolve.js';
import { contract, field, id, model } from '../testing/fixtures.js';
import { ANY_TARGET, type ModelDefinition } from '../types/definitions.js';
import { classifyChanges } from './classify.js';
import { diffDefinitions } from './diffDefinitions.js';

const featurable = contract({
  id: id(1),
  apiKey: 'featurable',
  fields: [field({ id: id(11), apiKey: 'title' })],
});
const listable = contract({ id: id(3), apiKey: 'listable' });
const post = model({ id: id(2), apiKey: 'post', fields: [field({ id: id(21), apiKey: 'title' })] });
const guide = model({ id: id(4), apiKey: 'guide', extends: id(2) });

const classified = (
  before: ModelDefinition | typeof featurable,
  after: ModelDefinition | typeof featurable,
) =>
  classifyChanges(diffDefinitions(before, after), { before, after }).map(
    ({ kind, property, from, to, category, breaking, destructive, prerequisites }) => ({
      kind,
      ...(property ? { property } : {}),
      from,
      to,
      category,
      breaking,
      destructive,
      prerequisites,
    }),
  );

describe('model.implements', () => {
  it('one change per interface joined or left, in ID order; joining is additive to the contract', () => {
    const before = { ...post, implements: [id(3)] };
    const after = { ...post, implements: [id(1)] };
    expect(classified(before, after)).toEqual([
      {
        kind: 'model.implements',
        property: id(1),
        from: null,
        to: id(1),
        category: 'contract',
        breaking: false,
        destructive: false,
        prerequisites: [],
      },
      {
        kind: 'model.implements',
        property: id(3),
        from: id(3),
        to: null,
        category: 'contract',
        breaking: true,
        destructive: false,
        prerequisites: [],
      },
    ]);
  });
});

describe('interface definitions', () => {
  it('contract changes need no content work; narrowing is breaking', () => {
    const added = {
      ...featurable,
      fields: [
        ...featurable.fields,
        ...listable.fields,
        { ...post.fields[0]!, id: id(12), apiKey: 'summary' },
      ],
    };
    expect(classified(featurable, added)).toMatchObject([
      { kind: 'field.added', category: 'contract', breaking: false, prerequisites: [] },
    ]);
    expect(classified(added, featurable)).toMatchObject([
      { kind: 'field.removed', category: 'contract', breaking: true, prerequisites: [] },
    ]);
    const required = {
      ...featurable,
      fields: [{ ...featurable.fields[0]!, required: true, filterable: true }],
    };
    expect(classified(featurable, required)).toMatchObject([
      { kind: 'field.required', category: 'contract', breaking: false, prerequisites: [] },
      { kind: 'field.filterable', category: 'contract', breaking: false, prerequisites: [] },
    ]);
    expect(classified(required, featurable)).toMatchObject([
      { kind: 'field.required', breaking: true },
      { kind: 'field.filterable', breaking: true },
    ]);
    const renamed = { ...featurable, pluralApiKey: 'highlights', label: 'Highlight' };
    expect(classified(featurable, renamed)).toMatchObject([
      { kind: 'definition.metadata', category: 'metadata' },
      { kind: 'definition.pluralApiKey', category: 'contract', breaking: true },
    ]);
  });
});

describe('relation target widening', () => {
  const holder = (target: string) =>
    model({
      id: id(9),
      apiKey: 'home',
      kind: 'singleton',
      fields: [
        field({
          id: id(91),
          apiKey: 'featured',
          type: 'relation',
          settings: { target, cardinality: 'many' },
        }),
      ],
    });
  const member = { ...post, implements: [id(1)] };
  const about = model({
    id: id(5),
    apiKey: 'about',
    kind: 'singleton',
    implements: [id(1)],
    fields: [field({ apiKey: 'title' })],
  });
  const schema = [featurable, listable, member, guide, about];
  const index = { before: createDefinitionIndex(schema), after: createDefinitionIndex(schema) };
  const targetChange = (from: string, to: string, withIndex = true) =>
    classifyChanges(diffDefinitions(holder(from), holder(to)), {
      before: holder(from),
      after: holder(to),
      ...(withIndex ? { index } : {}),
    }).map(({ category, breaking, destructive }) => ({ category, breaking, destructive }));

  it('keeps values when the new target accepts every entry the old one did', () => {
    const kept = [{ category: 'contract', breaking: true, destructive: false }];
    expect(targetChange(id(2), id(1))).toEqual(kept);
    expect(targetChange(id(2), ANY_TARGET)).toEqual(kept);
    expect(targetChange(id(1), ANY_TARGET)).toEqual(kept);
  });

  it('clears values when it narrows, and without the schema index', () => {
    const cleared = [{ category: 'conversion', breaking: true, destructive: true }];
    expect(targetChange(id(1), id(2))).toEqual(cleared);
    expect(targetChange(ANY_TARGET, id(1))).toEqual(cleared);
    expect(targetChange(id(3), id(1))).toEqual([
      { category: 'contract', breaking: true, destructive: false },
    ]);
    expect(targetChange(id(2), id(1), false)).toEqual(cleared);
  });
});
