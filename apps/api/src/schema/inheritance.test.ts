import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { resolveModel, resolveModelById, resolveRouteModel } from '../content/model.js';
import { createSchemaFieldVisibility } from './fieldVisibility.js';
import { buildChangePlan } from './planner/plan.js';
import type { SchemaRegistry } from './registry.js';
import { validateScoped } from './scopedValidation.js';
import { buildNetworkSchema, buildSnapshot, type ActiveDefinition } from './snapshot.js';

/** Model inheritance in the API's schema snapshot, content models, permissions and validation (WP1). */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({ kind: 'collection', label: 'x', fields: [], ...input } as never);
const active = (
  definition: SchemaDefinition,
  version = 1,
  siteId: string | null = null,
): ActiveDefinition => ({
  definition,
  siteId,
  version,
  revisionId: id(900 + Number.parseInt(definition.id.slice(-4), 16)),
  hash: 'h',
  activatedAt: new Date(0),
});

const seo = define({
  id: id(5),
  kind: 'component',
  apiKey: 'seo',
  fields: [{ id: id(51), apiKey: 'metaTitle', label: 'm', type: 'string' }],
});
const product = define({
  id: id(1),
  apiKey: 'product',
  pluralApiKey: 'products',
  fields: [
    { id: id(11), apiKey: 'name', label: 'n', type: 'string' },
    { id: id(12), apiKey: 'cost', label: 'c', type: 'integer', public: false },
    { id: id(13), apiKey: 'seo', label: 's', type: 'component', settings: { component: seo.id } },
  ],
});
const physical = define({
  id: id(2),
  apiKey: 'physicalProduct',
  pluralApiKey: 'physical',
  extends: product.id,
  fields: [{ id: id(21), apiKey: 'weight', label: 'w', type: 'integer' }],
});
const apparel = define({
  id: id(3),
  apiKey: 'apparel',
  pluralApiKey: 'apparels',
  extends: physical.id,
  fields: [{ id: id(31), apiKey: 'size', label: 's', type: 'string' }],
});
const digital = define({
  id: id(4),
  apiKey: 'digitalProduct',
  pluralApiKey: 'digital',
  extends: product.id,
  fields: [],
});
const definitions = [seo, product, physical, apparel, digital];
const snapshot = buildSnapshot(
  7,
  [active(seo), active(product, 3), active(physical, 2), active(apparel), active(digital)],
  [],
);

describe('schema snapshot: inheritance lookups', () => {
  it('resolves effective fields in ancestor order, keeping byId stored', () => {
    expect(snapshot.resolve(apparel.id)?.fields.map((field) => field.apiKey)).toEqual([
      'name',
      'cost',
      'seo',
      'weight',
      'size',
    ]);
    expect(snapshot.byId.get(apparel.id)?.definition.fields.map((field) => field.apiKey)).toEqual(['size']);
    expect(snapshot.resolve(seo.id)).toBeUndefined();
  });

  it('walks the family', () => {
    expect(snapshot.ancestors(apparel.id)).toEqual([product.id, physical.id]);
    expect(snapshot.childrenOf(product.id)).toEqual([physical.id, digital.id]);
    expect(snapshot.descendants(product.id)).toEqual([physical.id, apparel.id, digital.id]);
    expect(snapshot.family(physical.id)).toEqual([physical.id, apparel.id]);
    expect(snapshot.rootOf(apparel.id)).toBe(product.id);
  });

  it('lists every family member as dependent on a component a parent embeds', () => {
    expect(snapshot.dependentModelIds(seo.id)).toEqual([product.id, physical.id, apparel.id, digital.id]);
  });

  it('routes a child by its nested key only', () => {
    expect(snapshot.modelsByRouteKey.get('products/physical/apparels')?.definition.id).toBe(apparel.id);
    expect(snapshot.modelsByRouteKey.get('products/digital')?.definition.id).toBe(digital.id);
    expect(snapshot.modelsByRouteKey.has('digital')).toBe(false);
    expect(resolveRouteModel(snapshot, 'products/digital').definition.id).toBe(digital.id);
  });
});

describe('ContentModel', () => {
  it('carries the effective definition, the ancestors’ versions and components over inherited fields', () => {
    const model = resolveModel(snapshot, 'apparel');
    expect(model.definition.ancestorIds).toEqual([product.id, physical.id]);
    expect(model.definition.fields.find((field) => field.id === id(11))?.inheritedFrom).toBe(product.id);
    expect([...model.ancestors]).toEqual([
      [product.id, { version: 3, revisionId: snapshot.byId.get(product.id)?.revisionId }],
      [physical.id, { version: 2, revisionId: snapshot.byId.get(physical.id)?.revisionId }],
    ]);
    expect([...model.components.keys()]).toEqual([seo.id]);
    expect(resolveModelById(snapshot, product.id)?.ancestors.size).toBe(0);
  });
});

describe('field visibility', () => {
  it('reports a child’s effective fields with their public flags', async () => {
    const network = buildNetworkSchema(
      1,
      definitions.map((definition) => active(definition)),
      [],
    );
    const registry = { getSnapshot: () => Promise.resolve(network) } as unknown as SchemaRegistry;
    const visibility = createSchemaFieldVisibility(registry);
    expect(await visibility.getModelFields(digital.id)).toEqual([
      { id: id(11), public: true },
      { id: id(12), public: false },
      { id: id(13), public: true },
    ]);
    expect(await visibility.hasModel(apparel.id)).toBe(true);
    expect(await visibility.hasModel(seo.id)).toBe(false);
  });
});

describe('scoped validation: a type and its parent share a scope', () => {
  const siteA = id(700);
  const siteB = id(701);
  const codesOf = (family: Array<{ definition: SchemaDefinition; siteId: string | null }>) => {
    const proposed = [{ definition: seo, siteId: null }, ...family];
    return validateScoped(proposed, [...new Set(proposed.map((entry) => entry.siteId))]).map(
      (found) => `${found.definitionId ?? ''} ${found.path} ${found.code}`,
    );
  };

  it('accepts both shared or both on one site', () => {
    expect(
      codesOf([
        { definition: product, siteId: null },
        { definition: digital, siteId: null },
      ]),
    ).toEqual([]);
    expect(
      codesOf([
        { definition: product, siteId: siteA },
        { definition: digital, siteId: siteA },
      ]),
    ).toEqual([]);
  });

  it('refuses a child on a site under a shared parent, on another site, or a shared child of a site parent', () => {
    const expected = [`${digital.id} /extends INVALID_PARENT`];
    expect(
      codesOf([
        { definition: product, siteId: null },
        { definition: digital, siteId: siteA },
      ]),
    ).toEqual(expected);
    expect(
      codesOf([
        { definition: product, siteId: siteB },
        { definition: digital, siteId: siteA },
      ]),
    ).toEqual(expected);
    expect(
      codesOf([
        { definition: product, siteId: siteA },
        { definition: digital, siteId: null },
      ]),
    ).toEqual(expected);
  });

  it('says why', () => {
    const [found] = validateScoped(
      [
        { definition: seo, siteId: null },
        { definition: product, siteId: siteA },
        { definition: digital, siteId: null },
      ],
      [null],
      { siteKeys: new Map([[siteA, 'shop']]) },
    );
    expect(found?.message).toContain('"product" is on site "shop" and this type is shared with all sites');
  });
});

describe('planner', () => {
  const shared = definitions.map((definition) => ({ definition, siteId: null }));

  it('refuses to delete a type that others extend (HAS_CHILDREN)', () => {
    const plan = buildChangePlan({
      before: product,
      after: null,
      fromVersion: 3,
      active: shared,
      siteId: null,
      hasContent: true,
    });
    expect(plan.issues.map((found) => found.code)).toEqual(['HAS_CHILDREN', 'HAS_CHILDREN']);
    expect(plan.issues[0]?.message).toContain('"physicalProduct" extends "product"');
  });

  it('classifies a re-parent as a breaking contract change', () => {
    const moved = { ...apparel, extends: product.id } as SchemaDefinition;
    const plan = buildChangePlan({
      before: apparel,
      after: moved,
      fromVersion: 1,
      active: shared,
      siteId: null,
      hasContent: false,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toMatchObject([
      { kind: 'model.extends', from: physical.id, to: product.id, category: 'contract', breaking: true },
    ]);
    expect(plan.summary.breaking).toBe(true);
  });
});
