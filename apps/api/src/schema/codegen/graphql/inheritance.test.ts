import {
  generatedNames,
  normalizeDefinition,
  RESERVED_QUERY_NAMES,
  RESERVED_TYPE_NAMES,
  type DefinitionInput,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  assertValidSchema,
  execute,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isSpecifiedScalarType,
  Kind,
  parse,
  printType,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DENIED_POLICY,
  type PermissionEvaluator,
  type Policy,
  type PolicyRequest,
  type Principal,
} from '../../../permissions/types.js';
import * as contentDeliveryService from '../../../services/contentDelivery.js';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { fragmentsOf } from './complexity.js';
import type { GraphqlContext } from './context.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { operationUsage } from './usageSelection.js';
import { resolveSchemaVisibility } from './visibility.js';

vi.mock('../../../services/contentDelivery.js', () => ({ listDelivery: vi.fn(), getDelivery: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: DefinitionInput & { id: string }): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
  siteId: null,
});

const IDS = {
  badge: uuid(1),
  product: uuid(2),
  digital: uuid(3),
  physical: uuid(4),
  apparel: uuid(5),
  order: uuid(6),
  name: uuid(21),
  price: uuid(22),
  tone: uuid(23),
  sections: uuid(24),
  related: uuid(25),
  secret: uuid(26),
  fileSize: uuid(31),
  weight: uuid(41),
  size: uuid(51),
  item: uuid(61),
  download: uuid(62),
} as const;

const badge = define({
  id: IDS.badge,
  kind: 'component',
  apiKey: 'badge',
  label: 'Badge',
  fields: [{ id: uuid(11), apiKey: 'text', label: 'Text', type: 'string' }],
});
const product = define({
  id: IDS.product,
  kind: 'collection',
  apiKey: 'product',
  label: 'Product',
  localized: true,
  fields: [
    { id: IDS.name, apiKey: 'name', label: 'Name', type: 'string', filterable: true, sortable: true },
    { id: IDS.price, apiKey: 'price', label: 'Price', type: 'number', filterable: true, sortable: true },
    {
      id: IDS.tone,
      apiKey: 'tone',
      label: 'Tone',
      type: 'enum',
      settings: { values: [{ value: 'calm', label: 'Calm' }] },
    },
    {
      id: IDS.sections,
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [IDS.badge] },
    },
    {
      id: IDS.related,
      apiKey: 'related',
      label: 'Related',
      type: 'relation',
      settings: { target: IDS.product, cardinality: 'many' },
    },
    { id: IDS.secret, apiKey: 'secret', label: 'Secret', type: 'string', public: false },
  ],
});
const digital = define({
  id: IDS.digital,
  kind: 'collection',
  apiKey: 'digitalProduct',
  label: 'Digital product',
  extends: IDS.product,
  localized: true,
  fields: [{ id: IDS.fileSize, apiKey: 'fileSize', label: 'File size', type: 'integer', filterable: true }],
});
const physical = define({
  id: IDS.physical,
  kind: 'collection',
  apiKey: 'physicalProduct',
  label: 'Physical product',
  extends: IDS.product,
  localized: true,
  fields: [{ id: IDS.weight, apiKey: 'weight', label: 'Weight', type: 'number', sortable: true }],
});
const apparel = define({
  id: IDS.apparel,
  kind: 'collection',
  apiKey: 'apparel',
  pluralApiKey: 'apparelItems',
  label: 'Apparel',
  extends: IDS.physical,
  localized: true,
  fields: [
    {
      id: IDS.size,
      apiKey: 'size',
      label: 'Size',
      type: 'enum',
      settings: { values: [{ value: 'm', label: 'M' }] },
    },
  ],
});
const order = define({
  id: IDS.order,
  kind: 'collection',
  apiKey: 'order',
  label: 'Order',
  fields: [
    {
      id: IDS.item,
      apiKey: 'item',
      label: 'Item',
      type: 'relation',
      settings: { target: IDS.product, cardinality: 'one' },
    },
    {
      id: IDS.download,
      apiKey: 'download',
      label: 'Download',
      type: 'relation',
      settings: { target: IDS.digital, cardinality: 'many' },
    },
  ],
});

const definitions = [badge, product, digital, physical, apparel, order];
const snapshot = buildSnapshot(9, definitions.map(active), [
  { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
  { code: 'fr', label: 'French', isDefault: false, fallbacks: [] },
] as never);
const { schema } = buildGraphqlSchema(snapshot);

const fieldNames = (target: GraphQLSchema, typeName: string): string[] => {
  const type = target.getType(typeName);
  return isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)
    ? Object.keys(type.getFields())
    : [];
};
const interfacesOf = (target: GraphQLSchema, typeName: string): string[] => {
  const type = target.getType(typeName);
  return isObjectType(type) || isInterfaceType(type) ? type.getInterfaces().map(({ name }) => name) : [];
};
const fieldType = (target: GraphQLSchema, typeName: string, field: string): string => {
  const type = target.getType(typeName);
  return isObjectType(type) || isInterfaceType(type) ? String(type.getFields()[field]?.type) : '';
};

describe('GraphQL interfaces for models with children', () => {
  it('builds a valid schema whose names all come from naming.ts', () => {
    expect(() => assertValidSchema(schema)).not.toThrow();
    const generated = new Set(
      definitions
        .flatMap((definition) =>
          generatedNames(definition, { hasChildren: snapshot.childrenOf(definition.id).length > 0 }),
        )
        .map((name) => `${name.namespace}:${name.name}`),
    );
    for (const [name, type] of Object.entries(schema.getTypeMap())) {
      if (!name.startsWith('__') && !isSpecifiedScalarType(type)) {
        expect(generated.has(`type:${name}`) || RESERVED_TYPE_NAMES.includes(name), name).toBe(true);
      }
    }
    for (const name of Object.keys(schema.getQueryType()?.getFields() ?? {})) {
      expect(generated.has(`query:${name}`) || RESERVED_QUERY_NAMES.includes(name), name).toBe(true);
    }
  });

  it('gives each model with children an interface that every kind implements, transitively', () => {
    expect(schema.getType('DigitalProductInterface')).toBeUndefined();
    expect(schema.getType('ApparelInterface')).toBeUndefined();
    expect(interfacesOf(schema, 'Product')).toEqual(['Entry', 'ProductInterface']);
    expect(interfacesOf(schema, 'DigitalProduct')).toEqual(['Entry', 'ProductInterface']);
    expect(interfacesOf(schema, 'PhysicalProduct')).toEqual([
      'Entry',
      'ProductInterface',
      'PhysicalProductInterface',
    ]);
    expect(interfacesOf(schema, 'Apparel')).toEqual([
      'Entry',
      'ProductInterface',
      'PhysicalProductInterface',
    ]);
    expect(interfacesOf(schema, 'PhysicalProductInterface')).toEqual(['Entry', 'ProductInterface']);
    expect(interfacesOf(schema, 'Order')).toEqual(['Entry']);
  });

  it('puts the system fields and the effective fields on the interface, inherited first on each kind', () => {
    expect(fieldNames(schema, 'ProductInterface')).toEqual([
      'id',
      'locale',
      'createdAt',
      'updatedAt',
      'publishedAt',
      'localizations',
      'name',
      'price',
      'tone',
      'sections',
      'related',
      'secret',
    ]);
    expect(fieldNames(schema, 'Apparel')).toEqual([
      ...fieldNames(schema, 'ProductInterface'),
      'weight',
      'size',
    ]);
    expect(fieldType(schema, 'ProductInterface', 'localizations')).toBe('[ProductInterface!]');
    expect(fieldType(schema, 'DigitalProduct', 'localizations')).toBe('[DigitalProduct!]');
    expect(fieldType(schema, 'PhysicalProductInterface', 'localizations')).toBe(
      '[PhysicalProductInterface!]',
    );
  });

  it('shares the enum, zone and relation types of inherited fields with the declaring model', () => {
    for (const typeName of ['ProductInterface', 'Product', 'DigitalProduct', 'Apparel']) {
      expect(fieldType(schema, typeName, 'tone')).toBe('ProductToneEnum');
      expect(fieldType(schema, typeName, 'sections')).toBe('[ProductSectionsZone!]');
      expect(fieldType(schema, typeName, 'related')).toBe('[ProductInterface!]');
    }
    expect(fieldType(schema, 'Apparel', 'size')).toBe('ApparelSizeEnum');
    expect(schema.getType('DigitalProductToneEnum')).toBeUndefined();
    expect(fieldNames(schema, 'ProductSectionsZoneInput')).toEqual(['badge']);
    expect(schema.getType('DigitalProductSectionsZoneInput')).toBeUndefined();
  });

  it('serves the list and lookup of a model with children as its interface, a leaf kind as its type', () => {
    const query = schema.getQueryType()!;
    expect(String(query.getFields().product?.type)).toBe('ProductInterface');
    expect(fieldType(schema, 'ProductConnection', 'nodes')).toBe('[ProductInterface!]!');
    expect(String(query.getFields().physicalProduct?.type)).toBe('PhysicalProductInterface');
    expect(fieldType(schema, 'PhysicalProductConnection', 'nodes')).toBe('[PhysicalProductInterface!]!');
    expect(String(query.getFields().digitalProduct?.type)).toBe('DigitalProduct');
    expect(fieldType(schema, 'ApparelConnection', 'nodes')).toBe('[Apparel!]!');
    expect(fieldType(schema, 'Order', 'item')).toBe('ProductInterface');
    expect(fieldType(schema, 'Order', 'download')).toBe('[DigitalProduct!]');
  });

  it('builds filters, sorts and inputs over effective fields', () => {
    expect(fieldNames(schema, 'ProductFilter')).toEqual(expect.arrayContaining(['name', 'price']));
    expect(fieldNames(schema, 'ProductFilter')).not.toContain('fileSize');
    expect(fieldNames(schema, 'DigitalProductFilter')).toEqual(
      expect.arrayContaining(['name', 'price', 'fileSize']),
    );
    expect(fieldNames(schema, 'ApparelSort')).toEqual(expect.arrayContaining(['name', 'price', 'weight']));
    expect(fieldNames(schema, 'ApparelInput')).toEqual(
      expect.arrayContaining(['name', 'tone', 'sections', 'weight', 'size']),
    );
    const input = schema.getType('ApparelInput');
    expect(isInputObjectType(input) && String(input.getFields().tone?.type)).toBe('ProductToneEnum');
  });

  it('prints the family (the SDL reviewed in the plan)', () => {
    const printed = ['ProductInterface', 'PhysicalProductInterface', 'Product', 'DigitalProduct', 'Apparel']
      .map((name) => printType(schema.getType(name)!))
      .join('\n\n');
    expect(printed).toMatchSnapshot();
  });
});

const allow = (readIds: string[]): Policy => ({
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'only', fieldIds: readIds, componentFields: 'public' },
  rowReadMasks: null,
  writeMask: { mode: 'only', fieldIds: [], componentFields: 'public' },
  rowWriteMasks: null,
});
const evaluatorOf = (policies: Record<string, Policy>): PermissionEvaluator => ({
  evaluate: (_principal: Principal, request: PolicyRequest) =>
    Promise.resolve(policies[`${request.action}:${request.modelId}`] ?? DENIED_POLICY),
  canPerform: () => Promise.resolve(false),
  canPerformOnSite: () => Promise.resolve(false),
});
const DELIVERY: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId: 'r', siteId: 's' };
const deliverySchema = async (policies: Record<string, Policy>) =>
  buildGraphqlSchema(snapshot, await resolveSchemaVisibility(snapshot, evaluatorOf(policies), DELIVERY))
    .schema;

/** Shared public fields of every product. */
const SHARED = [IDS.name, IDS.price, IDS.tone, IDS.sections, IDS.related];

describe('GraphQL interfaces under a delivery caller', () => {
  it('gives a child-only reader the child type with its inherited fields and no parent names', async () => {
    const masked = await deliverySchema({ [`read:${IDS.digital}`]: allow([IDS.name, IDS.fileSize]) });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(masked.getType('ProductInterface')).toBeUndefined();
    expect(masked.getType('Product')).toBeUndefined();
    expect(masked.getType('PhysicalProduct')).toBeUndefined();
    expect(interfacesOf(masked, 'DigitalProduct')).toEqual(['Entry']);
    expect(fieldNames(masked, 'DigitalProduct')).toEqual(
      expect.arrayContaining(['id', 'localizations', 'name', 'fileSize']),
    );
    expect(Object.keys(masked.getQueryType()?.getFields() ?? {})).not.toContain('products');
  });

  it('keeps every interface field on each readable kind when a child grant widens a parent grant (D8)', async () => {
    // A grant on Products applies to every kind (the evaluator adds ancestors' grants); Digital adds its own.
    const masked = await deliverySchema({
      [`read:${IDS.product}`]: allow(SHARED),
      [`read:${IDS.digital}`]: allow([...SHARED, IDS.fileSize, IDS.secret]),
      [`read:${IDS.physical}`]: allow(SHARED),
      [`read:${IDS.apparel}`]: allow([...SHARED, IDS.size]),
    });
    expect(() => assertValidSchema(masked)).not.toThrow();
    const shared = fieldNames(masked, 'ProductInterface');
    expect(shared).not.toContain('secret');
    for (const kind of ['Product', 'DigitalProduct', 'PhysicalProduct', 'Apparel']) {
      expect(fieldNames(masked, kind)).toEqual(expect.arrayContaining(shared));
    }
    expect(fieldNames(masked, 'DigitalProduct')).toContain('secret');
    expect(fieldNames(masked, 'PhysicalProductInterface')).not.toContain('weight');
  });

  it('skips an unreadable ancestor from the interfaces a kind implements', async () => {
    const masked = await deliverySchema({
      [`read:${IDS.product}`]: allow(SHARED),
      [`read:${IDS.apparel}`]: allow([...SHARED, IDS.size]),
    });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(masked.getType('PhysicalProductInterface')).toBeUndefined();
    expect(interfacesOf(masked, 'Apparel')).toEqual(['Entry', 'ProductInterface']);
    expect(masked.getType('DigitalProduct')).toBeUndefined();
  });
});

const listDelivery = vi.mocked(contentDeliveryService.listDelivery);
const getDelivery = vi.mocked(contentDeliveryService.getDelivery);

const row = (id: number, model: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: uuid(id),
  locale: 'en',
  createdAt: 'c',
  updatedAt: 'u',
  publishedAt: 'p',
  ...(model ? { __model: model } : {}),
  name: `n${id}`,
  ...extra,
});

const contextOf = (entries: Record<string, Record<string, unknown>> = {}): GraphqlContext =>
  ({
    content: () => Promise.resolve({}),
    markDrafts: () => undefined,
    loaders: {
      entries: () => ({ load: (id: string) => Promise.resolve(entries[id] ?? null) }),
      localizations: () => ({ load: () => Promise.resolve([]) }),
    },
  }) as never;

const run = async (target: GraphQLSchema, source: string, context = contextOf()) =>
  execute({ schema: target, document: parse(source), contextValue: context });

describe('resolving rows to their kind', () => {
  beforeEach(() => {
    listDelivery.mockReset();
    getDelivery.mockReset();
  });

  it('types each row of a parent list by __model and leaves out rows of kinds absent from the schema', async () => {
    listDelivery.mockResolvedValue({
      data: [
        row(1, 'product'),
        row(2, 'digitalProduct', { fileSize: 10 }),
        row(3, 'apparel', { weight: 2, size: 'm' }),
        row(4, 'order'),
        row(5, undefined),
        row(6, 'unknownKind'),
      ],
      meta: { locale: 'en', snapshot: 1, pagination: { page: 1, pageSize: 25, pageCount: 1, total: 6 } },
    });
    const result = await run(
      schema,
      `{ products { nodes { __typename id name
          ... on DigitalProduct { fileSize }
          ... on PhysicalProductInterface { weight }
          ... on Apparel { size } } } }`,
    );
    expect(result.errors).toBeUndefined();
    expect((result.data as { products: { nodes: unknown[] } }).products.nodes).toEqual([
      { __typename: 'Product', id: uuid(1), name: 'n1' },
      { __typename: 'DigitalProduct', id: uuid(2), name: 'n2', fileSize: 10 },
      { __typename: 'Apparel', id: uuid(3), name: 'n3', weight: 2, size: 'm' },
    ]);
  });

  it('leaves out a kind the caller cannot read even when a row of it comes back', async () => {
    const masked = await deliverySchema({
      [`read:${IDS.product}`]: allow(SHARED),
      [`read:${IDS.apparel}`]: allow([...SHARED, IDS.size]),
    });
    listDelivery.mockResolvedValue({
      data: [row(1, 'product'), row(2, 'digitalProduct'), row(3, 'physicalProduct'), row(4, 'apparel')],
      meta: { locale: 'en', snapshot: 1, pagination: { page: 1, pageSize: 25, pageCount: 1, total: 4 } },
    });
    const result = await run(masked, '{ products { nodes { __typename id } } }');
    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { products: { nodes: Array<{ __typename: string }> } }).products.nodes.map(
        (node) => node.__typename,
      ),
    ).toEqual(['Product', 'Apparel']);
  });

  it('resolves a lookup and a relation to a parent by __model, null for an unservable row', async () => {
    getDelivery.mockResolvedValueOnce({ data: row(2, 'digitalProduct', { fileSize: 5 }) } as never);
    const one = await run(
      schema,
      `{ product(id: "${uuid(2)}") { __typename ... on DigitalProduct { fileSize } } }`,
    );
    expect(one.errors).toBeUndefined();
    expect(one.data).toEqual({ product: { __typename: 'DigitalProduct', fileSize: 5 } });

    getDelivery.mockResolvedValueOnce({ data: row(4, 'order') } as never);
    const wrongKind = await run(schema, `{ product(id: "${uuid(4)}") { id } }`);
    expect(wrongKind.errors).toBeUndefined();
    expect(wrongKind.data).toEqual({ product: null });

    listDelivery.mockResolvedValueOnce({
      data: [row(7, 'product', { related: [uuid(2), uuid(3), uuid(5)] })],
      meta: { locale: 'en', snapshot: 1, pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    });
    const related = await run(
      schema,
      '{ products { nodes { related { __typename id } } } }',
      contextOf({
        [uuid(2)]: row(2, 'digitalProduct'),
        [uuid(3)]: row(3, 'apparel'),
        [uuid(5)]: row(5, undefined),
      }),
    );
    expect(related.errors).toBeUndefined();
    expect(related.data).toEqual({
      products: {
        nodes: [
          {
            related: [
              { __typename: 'DigitalProduct', id: uuid(2) },
              { __typename: 'Apparel', id: uuid(3) },
            ],
          },
        ],
      },
    });
  });
});

describe('usage through interfaces', () => {
  const usageOf = (source: string) => {
    const document = parse(source);
    const operation = document.definitions.find(
      (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
    )!;
    const { reads } = operationUsage(schema, operation, fragmentsOf(document.definitions));
    return Object.fromEntries(
      [...reads].map(([modelId, paths]) => [modelId, paths.map(({ path }) => path).sort()]),
    );
  };

  it('counts interface fields against the parent and fragments against their type condition', () => {
    expect(
      usageOf(`{ products { nodes { name
          ... on DigitalProduct { fileSize name }
          ...Worn } } }
        fragment Worn on Apparel { size }`),
    ).toEqual({
      [IDS.product]: [IDS.name],
      [IDS.digital]: [IDS.fileSize, IDS.name].sort(),
      [IDS.apparel]: [IDS.size],
    });
  });

  it('counts a fragment inside a relation to a parent against the source model', () => {
    expect(usageOf('{ orders { nodes { item { name ... on DigitalProduct { fileSize } } } } }')).toEqual({
      [IDS.order]: [IDS.item, `${IDS.item}.${IDS.fileSize}`, `${IDS.item}.${IDS.name}`].sort(),
    });
  });

  it('flattens a fragment on the same type as before', () => {
    expect(usageOf('{ orders { nodes { ... on Order { item { id } } } } }')).toEqual({
      [IDS.order]: [IDS.item],
    });
  });
});
