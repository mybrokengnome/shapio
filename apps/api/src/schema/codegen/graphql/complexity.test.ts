import { normalizeDefinition } from '@shapio/schema';
import {
  getIntrospectionQuery,
  Kind,
  parse,
  validate as validateDocument,
  type OperationDefinitionNode,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../snapshot.js';
import {
  createLimitsRule,
  fragmentsOf,
  MAX_ALIASES_PER_SELECTION,
  measureOperation,
  RELATION_LIST_COST,
  selectsIntrospection,
  TOTAL_COUNT_COST,
} from './complexity.js';
import { buildGraphqlSchema } from './schemaBuilder.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const page = normalizeDefinition({
  id: uuid(1),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  fields: [
    { id: uuid(2), apiKey: 'title', label: 'Title', type: 'string' },
    {
      id: uuid(3),
      apiKey: 'links',
      label: 'Links',
      type: 'relation',
      settings: { target: uuid(1), cardinality: 'many' },
    },
  ],
});
const { schema } = buildGraphqlSchema(
  buildSnapshot(
    1,
    [
      {
        definition: page,
        siteId: null,
        version: 1,
        revisionId: uuid(9),
        hash: 'h',
        activatedAt: new Date(0),
      },
    ],
    [],
  ),
);

const measure = (source: string) => {
  const document = parse(source);
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  ) as OperationDefinitionNode;
  return measureOperation(schema, operation, fragmentsOf(document.definitions));
};

describe('query limits', () => {
  it('weighs a collection by its page size, nodes by page size and many-relations by their estimate', () => {
    // pages 10 (rows read) + nodes 1 + 10 × (title 1)
    expect(measure('{ pages(pageSize: 10) { nodes { title } } }')).toEqual({ cost: 21, depth: 3 });
    expect(measure('{ pages { nodes { title } } }').cost).toBe(25 + 1 + 25);
    expect(measure('{ pages(pageSize: 2) { nodes { links { title } } } }')).toEqual({
      cost: 2 + 1 + 2 * (1 + RELATION_LIST_COST),
      depth: 4,
    });
  });

  it('charges totalCount as a COUNT query', () => {
    expect(measure('{ pages(pageSize: 1) { totalCount } }').cost).toBe(1 + TOTAL_COUNT_COST);
    // 10,000 aliased counts are far over the default budget (20,000) even before the alias cap.
    const aliases = Array.from({ length: 10_000 }, (_, i) => `a${i}: pages { totalCount }`).join(' ');
    expect(measure(`{ ${aliases} }`).cost).toBe(10_000 * (25 + TOTAL_COUNT_COST));
  });

  it('assumes the maximum page size for variables without a default', () => {
    expect(measure('query ($n: Int) { pages(pageSize: $n) { nodes { title } } }').cost).toBe(100 + 1 + 100);
    expect(measure('query ($n: Int = 4) { pages(pageSize: $n) { nodes { title } } }').cost).toBe(9);
  });

  it('follows fragments and inline fragments, and never loops on a cycle', () => {
    expect(
      measure('{ ...Q } fragment Q on Query { pages(pageSize: 1) { nodes { ... on Page { title } } } }'),
    ).toEqual({ cost: 3, depth: 3 });
    expect(() => measure('{ ...A } fragment A on Query { ...B } fragment B on Query { ...A }')).not.toThrow();
  });

  it('exempts introspection and detects it through fragments', () => {
    expect(measure(getIntrospectionQuery())).toEqual({ cost: 0, depth: 0 });
    const document = parse('query { ...F } fragment F on Query { __schema { types { name } } }');
    const operation = document.definitions[0] as OperationDefinitionNode;
    expect(selectsIntrospection(operation.selectionSet, fragmentsOf(document.definitions))).toBe(true);
    const plain = parse('{ __typename pages { totalCount } }').definitions[0] as OperationDefinitionNode;
    expect(selectsIntrospection(plain.selectionSet, new Map())).toBe(false);
  });

  it('measures a fragment bomb in linear time, with the exact expanded cost', () => {
    // Each fragment spreads the next twice: 2^39 copies of `title` once expanded.
    const levels = 40;
    const fragments = Array.from({ length: levels }, (_, level) =>
      level === levels - 1
        ? `fragment F${level} on Page { title }`
        : `fragment F${level} on Page { ...F${level + 1} ...F${level + 1} }`,
    ).join('\n');
    const started = performance.now();
    const measured = measure(`{ pages(pageSize: 1) { nodes { ...F0 } } }\n${fragments}`);
    expect(performance.now() - started).toBeLessThan(100);
    // pages 1 (page size 1) + nodes 1 + 2^39 titles.
    expect(measured).toEqual({ cost: 2 + 2 ** 39, depth: 3 });

    const document = parse(`{ pages { nodes { ...F0 } } }\n${fragments}`);
    const operation = document.definitions[0] as OperationDefinitionNode;
    const introspectionCheck = performance.now();
    expect(selectsIntrospection(operation.selectionSet, fragmentsOf(document.definitions))).toBe(false);
    expect(performance.now() - introspectionCheck).toBeLessThan(100);
  });

  it(`refuses more than ${MAX_ALIASES_PER_SELECTION} aliases in one selection set`, () => {
    const validate = (count: number) => {
      const aliases = Array.from({ length: count }, (_, i) => `a${i}: __typename`).join(' ');
      return validateDocument(schema, parse(`{ ${aliases} }`), [
        createLimitsRule({ maxDepth: 10, maxComplexity: 20_000 }),
      ]).map((error) => error.extensions.code);
    };
    expect(validate(MAX_ALIASES_PER_SELECTION)).toEqual([]);
    expect(validate(MAX_ALIASES_PER_SELECTION + 1)).toEqual(['QUERY_TOO_MANY_ALIASES']);
  });
});
