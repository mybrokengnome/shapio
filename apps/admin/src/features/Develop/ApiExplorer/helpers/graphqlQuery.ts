import { collectionQueryName, type FieldDefinition, type ModelDefinition } from '@shapio/schema';

/**
 * Example GraphQL operations for a model, for the GraphQL tab (paste into GraphiQL). Field selections
 * follow the server's types: scalars as they are, rich text as `html`, media as `url`, relations as `id`,
 * components and zones as `__typename`.
 */
export type GraphqlOperation = { id: string; name: string; modelId: string; list: boolean; query: string };

const selectionOf = (field: FieldDefinition): string => {
  switch (field.type) {
    case 'richtext':
      return `${field.apiKey} { html }`;
    case 'media':
      return `${field.apiKey} { url alt }`;
    case 'relation':
      return `${field.apiKey} { id }`;
    case 'component':
    case 'dynamiczone':
      return `${field.apiKey} { __typename }`;
    default:
      return field.apiKey;
  }
};

const entrySelection = (model: ModelDefinition, indent: string) =>
  ['id', ...model.fields.filter((field) => !field.deprecated).map(selectionOf)]
    .map((line) => `${indent}${line}`)
    .join('\n');

/** The GraphiQL tab's operation IDs are prefixed so they never collide with REST operation IDs. */
export const GRAPHQL_OPERATION_PREFIX = 'graphql:';

export const graphqlOperations = (model: ModelDefinition): GraphqlOperation[] => {
  const single: GraphqlOperation = {
    id: `${GRAPHQL_OPERATION_PREFIX}${model.apiKey}`,
    name: model.apiKey,
    modelId: model.id,
    list: false,
    query:
      model.kind === 'collection'
        ? `query ($id: ID!) {\n  ${model.apiKey}(id: $id) {\n${entrySelection(model, '    ')}\n  }\n}\n`
        : `query {\n  ${model.apiKey} {\n${entrySelection(model, '    ')}\n  }\n}\n`,
  };
  if (model.kind !== 'collection') {
    return [single];
  }
  const listName = collectionQueryName(model);
  return [
    {
      id: `${GRAPHQL_OPERATION_PREFIX}${listName}`,
      name: listName,
      modelId: model.id,
      list: true,
      query: `query {\n  ${listName}(pageSize: 10) {\n    totalCount\n    nodes {\n${entrySelection(model, '      ')}\n    }\n  }\n}\n`,
    },
    single,
  ];
};
