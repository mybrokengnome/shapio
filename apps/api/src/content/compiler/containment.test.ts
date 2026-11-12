import { DATA_TYPES, normalizeDefinition, type DataType, type ModelDefinition } from '@shapio/schema';
import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import { compileFilter } from './compile.js';
import { contentDialectFor } from './dialect/index.js';
import { parseContentQuery } from './parse.js';
import { compileRowFilter } from './policy.js';
import { parseQueryTree } from './querystring.js';
import { FILTER_OPERATORS, type FilterNode } from './types.js';

/**
 * The guard behind `entry_heads.filter_data` (ADR 0001, "Filter data"): `shapio_scalar_fields`
 * drops top-level values that are null, objects, or arrays without a scalar element, which is only safe while
 * every containment document the compiler emits is `{fieldId: scalar}` or `{fieldId: [scalar]}` on a top-level
 * field, with a non-null scalar. This runs every operator on every data type (and its settings variants,
 * indexed or not) and fails if any containment has another shape. A new data type or operator is covered as
 * soon as it exists.
 */
const compiler = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: {} as never }) });

const MODEL_ID = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01';
const COMPONENT_ID = '0c0c0c0c-0000-4000-8000-000000000001';
const ASSET_ID = '7f7f7f7f-7777-4777-8777-777777777777';

type Variant = { type: DataType; settings?: Record<string, unknown>; label: string };

const variantsOf = (type: DataType): Variant[] => {
  switch (type) {
    case 'enum':
      return [false, true].map((multiple) => ({
        type,
        label: multiple ? 'multiple' : 'single',
        settings: { values: [{ value: 'a', label: 'A' }], multiple },
      }));
    case 'relation':
      return (['one', 'many'] as const).map((cardinality) => ({
        type,
        label: cardinality,
        settings: { target: MODEL_ID, cardinality },
      }));
    case 'media':
      return [false, true].map((multiple) => ({
        type,
        label: multiple ? 'multiple' : 'single',
        settings: { multiple },
      }));
    case 'component':
      return [false, true].map((repeatable) => ({
        type,
        label: repeatable ? 'repeatable' : 'single',
        settings: { component: COMPONENT_ID, repeatable },
      }));
    case 'dynamiczone':
      return [{ type, label: 'zone', settings: { components: [COMPONENT_ID] } }];
    default:
      return [{ type, label: 'plain' }];
  }
};

/** One field per (type, variant, indexed or not); stable IDs from the position. */
const FIELDS = DATA_TYPES.flatMap((type) => variantsOf(type)).flatMap((variant, index) =>
  [false, true].map((indexed) => ({
    id: `aaaaaaaa-0000-4000-8000-${String(index * 2 + (indexed ? 1 : 0)).padStart(12, '0')}`,
    apiKey: `f${index}${indexed ? 'i' : 'p'}`,
    label: `${variant.type} ${variant.label}${indexed ? ' indexed' : ''}`,
    type: variant.type,
    ...(variant.settings ? { settings: variant.settings } : {}),
    // Only scalars may be filterable or sortable.
    ...(indexed ? { filterable: true, sortable: true } : {}),
  })),
);

const model = normalizeDefinition({
  id: MODEL_ID,
  kind: 'collection',
  apiKey: 'everything',
  label: 'Everything',
  fields: FIELDS,
}) as ModelDefinition;

const context = {
  model,
  locales: ['en'],
  isReadable: () => true,
  isQueryable: () => true,
  allowSnapshot: true,
  resolveModel: () => model,
};

/** A value each type accepts (what a client would send). */
const SAMPLE: Partial<Record<DataType, string>> = {
  number: '1.5',
  integer: '2',
  decimal: '12.50',
  biginteger: '9007199254740993',
  boolean: 'true',
  date: '2026-10-01',
  datetime: '2026-10-01T10:00:00+02:00',
  time: '10:00:00',
  enum: 'a',
  relation: MODEL_ID,
  media: ASSET_ID,
  email: 'a@example.com',
  url: 'https://example.com/',
};

const querystringFor = (apiKey: string, type: DataType, operator: string) => {
  const value = encodeURIComponent(SAMPLE[type] ?? 'x');
  if (operator === '$in' || operator === '$nin') {
    return `filters[${apiKey}][${operator}][0]=${value}&filters[${apiKey}][${operator}][1]=${value}`;
  }
  return `filters[${apiKey}][${operator}]=${operator === '$null' || operator === '$notNull' ? 'true' : value}`;
};

const tryParse = (search: string): FilterNode | undefined => {
  try {
    return parseContentQuery(parseQueryTree(search), context).filter ?? undefined;
  } catch {
    // Not an allowed operator for this field: nothing to compile.
    return undefined;
  }
};

/** Every containment document a compiled filter binds (`@> $n::jsonb`). */
const containmentDocuments = (filter: FilterNode, form: 'filter' | 'document') => {
  const { sql, parameters } = compiler
    .selectNoFrom(compileFilter(filter, contentDialectFor('postgres', form)).as('x'))
    .compile();
  return [...sql.matchAll(/@> \$(\d+)::jsonb/g)].map((match): unknown =>
    JSON.parse(String(parameters[Number(match[1]) - 1])),
  );
};

const isScalar = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

describe('containment documents the compiler emits', () => {
  const cases = model.fields.flatMap((field) => FILTER_OPERATORS.map((operator) => ({ field, operator })));

  it('are {fieldId: scalar} or {fieldId: [scalar]} on a top-level field, for every type and operator', () => {
    const emittedBy = new Set<string>();
    for (const { field, operator } of cases) {
      const filter = tryParse(querystringFor(field.apiKey, field.type, operator));
      if (!filter) {
        continue;
      }
      for (const form of ['filter', 'document'] as const) {
        for (const document of containmentDocuments(filter, form)) {
          emittedBy.add(field.type);
          expect(document, `${field.label} ${operator}`).toBeTypeOf('object');
          const entries = Object.entries(document as Record<string, unknown>);
          expect(entries, `${field.label} ${operator}`).toHaveLength(1);
          const [fieldId, value] = entries[0] ?? [];
          expect(fieldId).toBe(field.id);
          const scalarOrScalarList =
            isScalar(value) || (Array.isArray(value) && value.length === 1 && value.every(isScalar));
          expect(scalarOrScalarList, `${field.label} ${operator}: ${JSON.stringify(value)}`).toBe(true);
        }
      }
    }
    // Not vacuous: every family that compiles to containment did.
    expect([...emittedBy].sort()).toEqual(
      [
        'boolean',
        'date',
        'datetime',
        'email',
        'enum',
        'integer',
        'media',
        'number',
        'relation',
        'slug',
        'string',
        'text',
        'time',
        'uid',
        'url',
      ].sort(),
    );
  });

  it('never come from structured types, which accept no operator at all', () => {
    for (const { field, operator } of cases) {
      if (['component', 'dynamiczone', 'json', 'richtext', 'code'].includes(field.type)) {
        expect(
          tryParse(querystringFor(field.apiKey, field.type, operator)),
          `${field.label} ${operator}`,
        ).toBe(undefined);
      }
    }
  });

  it('never come from row filters', () => {
    const principals = [
      { kind: 'admin', adminUserId: MODEL_ID },
      { kind: 'appUser', appUserId: MODEL_ID },
      { kind: 'anonymous' },
    ] as const;
    for (const principal of principals) {
      const filter = compileRowFilter(
        { kind: 'or', filters: [{ kind: 'ownedByPrincipal' }, { kind: 'and', filters: [] }] },
        principal as never,
        contentDialectFor('postgres'),
      );
      expect(compiler.selectNoFrom(filter?.as('x') as never).compile().sql).not.toContain('@>');
    }
  });
});
