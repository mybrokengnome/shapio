import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldIndexName } from '../../content/compiler/expressions.js';
import { buildChangePlan, type PlanInput } from './plan.js';
import type { ContentStep, FollowUpStep } from './steps.js';

/** Planning changes to a family of types (plan polymorphic-types, decisions 5 and 6). */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({ kind: 'collection', label: 'x', fields: [], ...input } as never);

const seo = define({
  id: id(9),
  kind: 'component',
  apiKey: 'seo',
  fields: [{ id: id(91), apiKey: 'metaTitle', label: 'm', type: 'string' }],
});
const product = define({
  id: id(1),
  apiKey: 'product',
  fields: [
    { id: id(11), apiKey: 'name', label: 'n', type: 'string' },
    { id: id(12), apiKey: 'sku', label: 's', type: 'string', unique: true, filterable: true },
    { id: id(13), apiKey: 'seo', label: 'seo', type: 'component', settings: { component: seo.id } },
  ],
});
const digital = define({
  id: id(2),
  apiKey: 'digital',
  extends: product.id,
  fields: [{ id: id(21), apiKey: 'url', label: 'u', type: 'string' }],
});
const ebook = define({ id: id(3), apiKey: 'ebook', extends: digital.id });
const gadget = define({
  id: id(4),
  apiKey: 'gadget',
  fields: [{ id: id(41), apiKey: 'serial', label: 's', type: 'string', unique: true, sortable: true }],
});
const definitions = [seo, product, digital, ebook, gadget];
const shared = (list: readonly SchemaDefinition[]) =>
  list.map((definition) => ({ definition, siteId: null }));

const plan = (before: SchemaDefinition, after: SchemaDefinition | null, overrides: Partial<PlanInput> = {}) =>
  buildChangePlan({
    before,
    after,
    fromVersion: 1,
    active: shared(definitions),
    siteId: null,
    hasContent: true,
    ...overrides,
  });

const index = (modelId: string, fieldId: string) =>
  fieldIndexName({ modelId, fieldId, type: 'string', localized: false });

describe('a change to a parent', () => {
  const withRequired = {
    ...product,
    fields: [
      ...product.fields,
      {
        ...product.fields[0],
        id: id(14),
        apiKey: 'brand',
        required: true,
        defaultValue: 'acme',
        filterable: true,
      },
    ],
  } as SchemaDefinition;
  const result = plan(product, withRequired);

  it('affects the whole family', () => {
    expect(result.affectedModelIds).toEqual([product.id, digital.id, ebook.id]);
  });

  it('backfills every member in one step and indexes each member', () => {
    const backfills = result.prerequisites.filter((step) => step.kind === 'backfill') as ContentStep[];
    expect(backfills).toEqual([
      {
        kind: 'backfill',
        ownerId: product.id,
        fieldId: id(14),
        value: 'acme',
        locations: [
          { modelId: product.id, path: [] },
          { modelId: digital.id, path: [] },
          { modelId: ebook.id, path: [] },
        ],
      },
    ]);
    expect(
      result.prerequisites
        .filter((step) => step.kind === 'buildIndex')
        .map((step) => step.kind === 'buildIndex' && step.indexName),
    ).toEqual([index(product.id, id(14)), index(digital.id, id(14)), index(ebook.id, id(14))]);
  });

  it('keeps the stored diff as the plan’s changes', () => {
    expect(result.changes.map((change) => change.kind)).toEqual(['field.added']);
  });

  it('releases a removed unique field’s registry rows for the family only', () => {
    const removed = plan(product, {
      ...product,
      fields: product.fields.filter((field) => field.id !== id(12)),
    });
    expect(removed.followUps.filter((step) => step.kind === 'releaseUnique')).toEqual([
      { kind: 'releaseUnique', fieldId: id(12), modelIds: [product.id, digital.id, ebook.id] },
    ]);
    // A field its own model removes keeps its stored values (no strip).
    expect(removed.prerequisites.filter((step) => step.kind === 'convert')).toEqual([]);
    expect(removed.summary.destructive).toBe(false);
  });

  it('checks a newly unique field per member, naming the parent as owner', () => {
    const unique = plan(product, {
      ...product,
      fields: product.fields.map((field) => (field.id === id(11) ? { ...field, unique: true } : field)),
    });
    expect(unique.prerequisites.filter((step) => step.kind === 'checkUnique')).toEqual([
      { kind: 'checkUnique', modelId: product.id, fieldId: id(11) },
      { kind: 'checkUnique', modelId: digital.id, fieldId: id(11), ownerId: product.id },
      { kind: 'checkUnique', modelId: ebook.id, fieldId: id(11), ownerId: product.id },
    ]);
  });
});

describe('a component embedded by a parent', () => {
  it('converts its values in every member that inherits the field', () => {
    const changed = {
      ...seo,
      fields: [{ ...seo.fields[0], required: true, defaultValue: 'x' }],
    } as SchemaDefinition;
    const result = plan(seo, changed);
    expect(result.affectedModelIds).toEqual([product.id, digital.id, ebook.id]);
    const backfill = result.prerequisites.find((step) => step.kind === 'backfill') as ContentStep & {
      locations: unknown[];
    };
    expect(backfill.locations).toEqual([
      { modelId: product.id, path: [id(13)] },
      { modelId: digital.id, path: [id(13)] },
      { modelId: ebook.id, path: [id(13)] },
    ]);
  });
});

describe('re-parenting', () => {
  const moved = { ...digital, extends: gadget.id } as SchemaDefinition;
  const result = plan(digital, moved);

  it('is a breaking contract change in the stored diff', () => {
    expect(result.changes).toMatchObject([{ kind: 'model.extends', category: 'contract', breaking: true }]);
    expect(result.summary.breaking).toBe(true);
  });

  it('strips the values of every lost inherited field, in the moved model and its descendants', () => {
    const converts = result.prerequisites.filter(
      (step): step is Extract<ContentStep, { kind: 'convert' }> => step.kind === 'convert',
    );
    expect(converts.map((step) => [step.change.fieldId, step.change.dropsValues, step.locations])).toEqual(
      [id(11), id(12), id(13)].map((fieldId) => [
        fieldId,
        true,
        [
          { modelId: digital.id, path: [] },
          { modelId: ebook.id, path: [] },
        ],
      ]),
    );
    expect(result.summary.destructive).toBe(true);
  });

  it('checks gained unique fields, indexes them, drops lost indexes and releases lost unique rows', () => {
    expect(result.prerequisites.filter((step) => step.kind === 'checkUnique')).toEqual([
      { kind: 'checkUnique', modelId: digital.id, fieldId: id(41) },
      { kind: 'checkUnique', modelId: ebook.id, fieldId: id(41), ownerId: digital.id },
    ]);
    expect(
      result.prerequisites
        .filter((step) => step.kind === 'buildIndex')
        .map((step) => step.kind === 'buildIndex' && step.indexName),
    ).toEqual([index(digital.id, id(41)), index(ebook.id, id(41))]);
    const drops = result.followUps.filter(
      (step): step is Extract<FollowUpStep, { kind: 'dropIndex' }> => step.kind === 'dropIndex',
    );
    expect(drops.map((step) => step.indexName)).toEqual(
      expect.arrayContaining([index(digital.id, id(12)), index(ebook.id, id(12))]),
    );
    expect(result.followUps.filter((step) => step.kind === 'releaseUnique')).toEqual([
      { kind: 'releaseUnique', fieldId: id(12), modelIds: [digital.id, ebook.id] },
    ]);
  });
});

describe('creating a child', () => {
  it('builds the indexes of inherited fields after activation', () => {
    const child = define({ id: id(5), apiKey: 'physical', extends: product.id });
    const result = buildChangePlan({
      before: null,
      after: child,
      fromVersion: null,
      active: shared(definitions),
      siteId: null,
      hasContent: false,
    });
    expect(result.issues).toEqual([]);
    expect(result.prerequisites).toEqual([]);
    expect(result.followUps.map((step) => step.kind === 'buildIndex' && step.indexName)).toEqual([
      index(child.id, id(12)),
    ]);
  });
});
