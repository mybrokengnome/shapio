import { describe, expect, it } from 'vitest';
import { MAX_INHERITANCE_DEPTH } from '../inheritance/resolve.js';
import { component, field, id, model } from '../testing/fixtures.js';
import type { SchemaDefinition } from '../types/definitions.js';
import { generatedNames } from './naming.js';
import { parseDefinition } from './parse.js';
import { findDependentModels, validateSchema } from './schema.js';

const codes = (definitions: readonly SchemaDefinition[]) =>
  validateSchema(definitions).map((found) => `${found.definitionId ?? ''} ${found.path} ${found.code}`);

const product = model({
  id: id(1),
  apiKey: 'product',
  pluralApiKey: 'products',
  fields: [
    field({ id: id(11), apiKey: 'name' }),
    field({ id: id(12), apiKey: 'price', type: 'integer', sortable: true }),
    field({ id: id(13), apiKey: 'body', type: 'richtext' }),
  ],
});
const digital = model({
  id: id(2),
  apiKey: 'digitalProduct',
  pluralApiKey: 'digital',
  extends: id(1),
  fields: [field({ id: id(21), apiKey: 'downloadUrl', type: 'url' })],
});

describe('checkInheritance', () => {
  it('accepts a valid family', () => {
    expect(codes([product, digital])).toEqual([]);
  });

  it('UNKNOWN_PARENT: extends a type that does not exist', () => {
    expect(codes([digital])).toEqual([`${id(2)} /extends UNKNOWN_PARENT`]);
  });

  it('INVALID_PARENT: a singleton, a component, the model itself, or a child that is not a collection', () => {
    const home = model({ id: id(3), apiKey: 'home', kind: 'singleton' });
    expect(codes([home, { ...digital, extends: id(3) }])).toContain(`${id(2)} /extends INVALID_PARENT`);
    const hero = component({ id: id(4), apiKey: 'hero' });
    expect(codes([hero, { ...digital, extends: id(4) }])).toContain(`${id(2)} /extends INVALID_PARENT`);
    expect(codes([{ ...digital, extends: id(2) }])).toContain(`${id(2)} /extends INVALID_PARENT`);
    const singleChild = model({ id: id(5), apiKey: 'about', kind: 'singleton', extends: id(1) });
    expect(codes([product, singleChild])).toContain(`${id(5)} /extends INVALID_PARENT`);
  });

  it('INHERITANCE_CYCLE: reported on every member of the cycle', () => {
    const a = model({ id: id(5), apiKey: 'a', extends: id(6) });
    const b = model({ id: id(6), apiKey: 'b', extends: id(5) });
    expect(codes([a, b])).toEqual([
      `${id(5)} /extends INHERITANCE_CYCLE`,
      `${id(6)} /extends INHERITANCE_CYCLE`,
    ]);
  });

  it('INHERITANCE_TOO_DEEP: past the level limit', () => {
    const levels = Array.from({ length: MAX_INHERITANCE_DEPTH + 1 }, (_, index) =>
      model({
        id: id(100 + index),
        apiKey: `level${index}`,
        ...(index > 0 ? { extends: id(99 + index) } : {}),
      }),
    );
    expect(codes(levels)).toEqual([`${id(100 + MAX_INHERITANCE_DEPTH)} /extends INHERITANCE_TOO_DEEP`]);
    expect(codes(levels.slice(0, MAX_INHERITANCE_DEPTH))).toEqual([]);
  });

  it('INHERITED_FLAG_MISMATCH: localized and draftAndPublish must equal the parent’s, naming the value', () => {
    const issues = validateSchema([product, { ...digital, localized: true, draftAndPublish: false }]);
    expect(issues.map((found) => `${found.path} ${found.code}`)).toEqual([
      '/localized INHERITED_FLAG_MISMATCH',
      '/draftAndPublish INHERITED_FLAG_MISMATCH',
    ]);
    expect(issues[0]?.message).toContain('set "localized" to false');
  });

  it('INHERITED_FIELD_COLLISION: an own field’s API ID equals an inherited one (case-insensitive)', () => {
    const clash = { ...digital, fields: [...digital.fields, field({ id: id(22), apiKey: 'Price' })] };
    expect(codes([product, clash as SchemaDefinition])).toContain(
      `${id(2)} /fields/1/apiKey INHERITED_FIELD_COLLISION`,
    );
  });

  it('validates a child’s display against its resolved fields', () => {
    const ok = model({
      ...digital,
      display: { titleFieldId: id(11), defaultSort: { fieldId: id(12), direction: 'asc' } },
    });
    expect(codes([product, ok])).toEqual([]);
    const bad = model({ ...digital, display: { listFieldIds: [id(99)] } });
    expect(codes([product, bad])).toEqual([`${id(2)} /display/listFieldIds/0 UNKNOWN_FIELD_REFERENCE`]);
  });

  it('reports a child’s group issues on its own group paths', () => {
    const parent = model({
      ...product,
      display: { groups: [{ id: 'main', label: 'Main', fieldIds: [id(11)] }] },
    });
    const child = model({
      ...digital,
      display: {
        groups: [
          { id: 'extra', label: 'Extra', fieldIds: [id(21)] },
          { id: 'more', label: 'More', fieldIds: [id(11)] },
        ],
      },
    });
    expect(codes([parent, child])).toEqual([`${id(2)} /display/groups/1/fieldIds/0 INVALID_FIELD_REFERENCE`]);
  });
});

describe('parseDefinition with extends', () => {
  it('leaves display references of a child to the schema-level check', () => {
    const parsed = parseDefinition({ ...digital, display: { titleFieldId: id(11) } });
    expect(parsed.ok).toBe(true);
  });

  it('still checks display references of a model that extends nothing', () => {
    const parsed = parseDefinition({ ...product, display: { titleFieldId: id(99) } });
    expect(parsed.ok).toBe(false);
  });
});

describe('generated names', () => {
  it('a child emits no names for inherited fields', () => {
    const colour = model({
      ...product,
      fields: [
        field({
          id: id(14),
          apiKey: 'colour',
          type: 'enum',
          settings: { values: [{ value: 'red', label: 'Red' }] },
        }),
      ],
    });
    expect(generatedNames(digital).map((name) => name.name)).not.toContain('DigitalProductColourEnum');
    expect(codes([colour, digital])).toEqual([]);
  });

  it('reserves <Type>Interface only for a model with children', () => {
    expect(generatedNames(product, { hasChildren: true }).map((name) => name.name)).toContain(
      'ProductInterface',
    );
    expect(generatedNames(product).map((name) => name.name)).not.toContain('ProductInterface');
    const productInterface = model({ id: id(7), apiKey: 'productInterface' });
    expect(codes([product, productInterface])).toEqual([]);
    expect(codes([product, digital, productInterface])).toContain(
      `${id(7)} /apiKey GENERATED_NAME_COLLISION`,
    );
  });
});

describe('findDependentModels through inheritance', () => {
  it('reaches the descendants of a model that embeds the component', () => {
    const seo = component({ id: id(8), apiKey: 'seo' });
    const parent = model({
      ...product,
      fields: [
        ...product.fields,
        field({ id: id(15), apiKey: 'seo', type: 'component', settings: { component: id(8) } }),
      ],
    });
    const grandchild = model({ id: id(3), apiKey: 'ebook', extends: id(2) });
    expect(findDependentModels([seo, parent, digital, grandchild], id(8)).map((found) => found.id)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });
});
