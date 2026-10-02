import { normalizeDefinition, type DefinitionInput, type SchemaDefinition } from '@shapio/schema';
import { Kind, parse, type OperationDefinitionNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { fragmentsOf } from './complexity.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { operationUsage } from './usageSelection.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: DefinitionInput & { id: string }): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
});

const author = define({
  id: uuid(1),
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  fields: [
    { id: uuid(11), apiKey: 'name', label: 'Name', type: 'string' },
    { id: uuid(12), apiKey: 'bio', label: 'Bio', type: 'text' },
  ],
});
const article = define({
  id: uuid(2),
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: uuid(21), apiKey: 'title', label: 'Title', type: 'string' },
    { id: uuid(22), apiKey: 'body', label: 'Body', type: 'richtext' },
    {
      id: uuid(23),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: uuid(1), cardinality: 'one' },
    },
  ],
});

const { schema } = buildGraphqlSchema(
  buildSnapshot(3, [active(author), active(article)], [
    { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
  ] as never),
);

const usageOf = (query: string, variables: Record<string, unknown> = {}) => {
  const document = parse(query);
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  ) as OperationDefinitionNode;
  const { reads, snapshot } = operationUsage(schema, operation, fragmentsOf(document.definitions), variables);
  return {
    snapshot,
    reads: Object.fromEntries(
      [...reads].map(([modelId, fields]) => [modelId, fields.map((field) => field.path).sort()]),
    ),
  };
};

describe('GraphQL usage selection', () => {
  it('records entry fields through connections and relation target fields one level deep', () => {
    expect(
      usageOf(`{ articles(snapshot: 7) { nodes { title author { name author: __typename } } totalCount } }`),
    ).toEqual({ snapshot: 7, reads: { [uuid(2)]: [uuid(21), uuid(23), `${uuid(23)}.${uuid(11)}`].sort() } });
  });

  it('follows named and inline fragments, and localizations read the same model', () => {
    const query = `
      query Q { article(id: "x") { ...Parts localizations { body } } author(id: "y") { ... on Author { bio } } }
      fragment Parts on Article { title ...More }
      fragment More on Article { author { ...Names } }
      fragment Names on Author { name }
    `;
    expect(usageOf(query).reads).toEqual({
      [uuid(2)]: [uuid(21), uuid(22), uuid(23), `${uuid(23)}.${uuid(11)}`].sort(),
      [uuid(1)]: [uuid(12)],
    });
  });

  it('skips draft (preview) root reads, including through variables', () => {
    expect(usageOf('{ articles(publicationState: DRAFT) { nodes { title } } }').reads).toEqual({});
    expect(
      usageOf('query ($s: PublicationState) { articles(publicationState: $s) { nodes { title } } }', {
        s: 'DRAFT',
      }).reads,
    ).toEqual({});
  });

  it('reads nothing from mutations, introspection or the fixed root fields', () => {
    expect(usageOf('{ __schema { types { name } } _schemaVersion }').reads).toEqual({});
    expect(usageOf('mutation { deleteArticle(id: "x") { title } }').reads).toEqual({});
  });

  it('expands each fragment once per context (no exponential walk)', () => {
    const fragments = Array.from({ length: 30 }, (_, index) =>
      index === 29
        ? `fragment F${index} on Article { title }`
        : `fragment F${index} on Article { ...F${index + 1} ...F${index + 1} }`,
    ).join('\n');
    const started = Date.now();
    expect(usageOf(`{ articles { nodes { ...F0 } } }\n${fragments}`).reads).toEqual({
      [uuid(2)]: [uuid(21)],
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
