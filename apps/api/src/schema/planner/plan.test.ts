import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldIndexName } from '../../content/compiler/expressions.js';
import { buildChangePlan } from './plan.js';
import { findValueLocations } from './steps.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({ kind: 'collection', label: 'x', fields: [], ...input } as never);

const hero = define({
  id: id(10),
  kind: 'component',
  apiKey: 'hero',
  fields: [{ id: id(11), apiKey: 'heading', label: 'h', type: 'string' }],
});
const section = define({
  id: id(20),
  kind: 'component',
  apiKey: 'section',
  fields: [{ id: id(21), apiKey: 'hero', label: 'h', type: 'component', settings: { component: hero.id } }],
});
const page = define({
  id: id(30),
  apiKey: 'page',
  fields: [
    { id: id(31), apiKey: 'title', label: 't', type: 'string' },
    {
      id: id(32),
      apiKey: 'body',
      label: 'b',
      type: 'dynamiczone',
      settings: { components: [section.id, hero.id] },
    },
  ],
});
const active = [hero, section, page];
/** Every definition shared (the planner takes the full set with scopes). */
const shared = (definitions: readonly SchemaDefinition[]) =>
  definitions.map((definition) => ({ definition, siteId: null }));

describe('findValueLocations', () => {
  it('finds a component under every path of every embedding model', () => {
    expect(findValueLocations(active, hero.id)).toEqual([
      { modelId: page.id, path: [id(32), id(21)] },
      { modelId: page.id, path: [id(32)] },
    ]);
    expect(findValueLocations(active, page.id)).toEqual([{ modelId: page.id, path: [] }]);
  });
});

describe('buildChangePlan', () => {
  it('a required field on a component validates content in every dependent model', () => {
    const after = define({
      ...hero,
      fields: [...hero.fields, { id: id(12), apiKey: 'tagline', label: 't', type: 'string', required: true }],
    });
    const plan = buildChangePlan({
      before: hero,
      after,
      fromVersion: 1,
      active: shared(active),
      siteId: null,
      hasContent: true,
    });
    expect(plan).toMatchObject({
      operation: 'update',
      affectedModelIds: [page.id],
      prerequisites: [
        {
          kind: 'validateRequired',
          ownerId: hero.id,
          fieldId: id(12),
          locations: findValueLocations(active, hero.id),
        },
      ],
      issues: [],
    });
  });

  it('a new model has no prerequisites: its indexes are built right after activation', () => {
    const fresh = define({
      id: id(40),
      apiKey: 'listing',
      fields: [
        {
          id: id(41),
          apiKey: 'rank',
          label: 'r',
          type: 'integer',
          sortable: true,
          required: true,
          unique: true,
        },
      ],
    });
    const plan = buildChangePlan({
      before: null,
      after: fresh,
      fromVersion: null,
      active: shared(active),
      siteId: null,
      hasContent: false,
    });
    expect(plan.operation).toBe('create');
    expect(plan.prerequisites).toEqual([]);
    expect(plan.followUps).toEqual([
      {
        kind: 'buildIndex',
        modelId: fresh.id,
        fieldId: id(41),
        fieldType: 'integer',
        localized: false,
        indexName: fieldIndexName({ modelId: fresh.id, fieldId: id(41), type: 'integer', localized: false }),
      },
    ]);
  });

  it('rewrites content before any check, and validates whole entries last', () => {
    const before = define({
      id: id(60),
      apiKey: 'offer',
      fields: [
        { id: id(61), apiKey: 'price', label: 'p', type: 'integer' },
        { id: id(62), apiKey: 'code', label: 'c', type: 'string' },
      ],
    });
    // A type change listed before a new required field with a default: the whole-entry validation of the
    // conversion must still see the backfilled value.
    const after = define({
      ...before,
      fields: [
        { ...before.fields[0], type: 'decimal', settings: {}, editor: { id: 'decimalInput', options: {} } },
        { ...before.fields[1], unique: true },
        { id: id(63), apiKey: 'origin', label: 'o', type: 'string', required: true, defaultValue: 'unknown' },
      ],
    });
    const plan = buildChangePlan({
      before,
      after,
      fromVersion: 1,
      active: shared([...active, before]),
      siteId: null,
      hasContent: true,
    });
    expect(plan.prerequisites.map((step) => step.kind)).toEqual([
      'convert',
      'backfill',
      'checkUnique',
      'validateValues',
    ]);
  });

  it('a type change on an indexed field builds the new expression index first and drops the old one after', () => {
    const before = define({
      id: id(50),
      apiKey: 'score',
      fields: [{ id: id(51), apiKey: 'value', label: 'v', type: 'number', filterable: true }],
    });
    const after = define({
      ...before,
      fields: [
        { ...before.fields[0], type: 'string', settings: {}, editor: { id: 'textInput', options: {} } },
      ],
    });
    const plan = buildChangePlan({
      before,
      after,
      fromVersion: 3,
      active: shared([...active, before]),
      siteId: null,
      hasContent: true,
    });
    expect(plan.prerequisites.map((step) => step.kind)).toEqual(['convert', 'validateValues', 'buildIndex']);
    const dropped = { modelId: before.id, fieldId: id(51), type: 'number' as const, localized: false };
    expect(plan.followUps).toEqual([
      { kind: 'dropIndex', indexName: fieldIndexName(dropped) },
      // The layout before sites, in case the layout job has not rebuilt it yet.
      { kind: 'dropIndex', indexName: fieldIndexName(dropped, 1) },
    ]);
  });

  it('reports schema-wide issues and blocks deleting referenced definitions', () => {
    const clash = define({ id: id(60), apiKey: 'pageFilter' });
    expect(
      buildChangePlan({
        before: null,
        after: clash,
        fromVersion: null,
        active: shared(active),
        siteId: null,
        hasContent: false,
      }).issues,
    ).toMatchObject([{ code: 'GENERATED_NAME_COLLISION' }]);
    const deletion = buildChangePlan({
      before: hero,
      after: null,
      fromVersion: 1,
      active: shared(active),
      siteId: null,
      hasContent: true,
    });
    expect(deletion.operation).toBe('delete');
    expect(deletion.issues.map((found) => found.code)).toEqual([
      'REFERENCED_DEFINITION',
      'REFERENCED_DEFINITION',
    ]);
  });
});
