import {
  collectionQueryName,
  isModelDefinition,
  MUTATION_PREFIXES,
  routeKeyOf,
  toTypeName,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * The API shapes a definition produces, derived from the registry naming helpers in `@shapio/schema`
 * (`routeKeyOf`, `toTypeName`, `collectionQueryName`, `MUTATION_PREFIXES`), the same names the server's
 * OpenAPI and GraphQL builders use. Previews of a definition being edited, before it exists on the server.
 */
export type DefinitionLookup = ReadonlyMap<string, SchemaDefinition>;

export type RestEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  scope: 'delivery' | 'admin';
};

const liveFields = (definition: SchemaDefinition) => definition.fields.filter((field) => !field.deprecated);

export const restEndpoints = (definition: SchemaDefinition): RestEndpoint[] => {
  if (!isModelDefinition(definition)) {
    return [];
  }
  const delivery = `/api/content/${routeKeyOf(definition)}`;
  const admin = `/api/admin/content/${definition.apiKey}`;
  const collection = definition.kind === 'collection';
  return [
    { method: 'GET', path: delivery, scope: 'delivery' },
    ...(collection ? [{ method: 'GET' as const, path: `${delivery}/{id}`, scope: 'delivery' as const }] : []),
    { method: 'GET', path: admin, scope: 'admin' },
    { method: 'POST', path: admin, scope: 'admin' },
    { method: 'GET', path: `${admin}/{id}`, scope: 'admin' },
    { method: 'PUT', path: `${admin}/{id}`, scope: 'admin' },
    { method: 'DELETE', path: `${admin}/{id}`, scope: 'admin' },
    { method: 'POST', path: `${admin}/{id}/publish`, scope: 'admin' },
    { method: 'POST', path: `${admin}/{id}/unpublish`, scope: 'admin' },
  ];
};

/** Delivery's default rich-text shape (`richText=json`); `html` and `both` add the rendered HTML. */
const RICH_TEXT_SAMPLE = {
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [] },
};

const MEDIA_SAMPLE = { id: '<uuid>', url: '<url>', mimeType: '<mime type>', alt: '' };

/** Nesting depth for component samples (components inside components show as `{}` below it). */
const MAX_SAMPLE_DEPTH = 2;

const sampleValue = (field: FieldDefinition, lookup: DefinitionLookup, depth: number): unknown => {
  const many = (multiple: boolean, value: unknown) => (multiple ? [value] : value);
  switch (field.type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'json':
      return {};
    case 'richtext':
      return RICH_TEXT_SAMPLE;
    case 'media':
      return many(field.settings.multiple, MEDIA_SAMPLE);
    case 'enum':
      return many(field.settings.multiple, field.settings.values[0]?.value ?? '');
    case 'relation':
      return many(field.settings.cardinality === 'many', '<entry id>');
    case 'component': {
      const component = lookup.get(field.settings.component);
      return many(field.settings.repeatable, component ? sampleObject(component, lookup, depth + 1) : {});
    }
    case 'dynamiczone':
      return field.settings.components.slice(0, 1).flatMap((id) => {
        const component = lookup.get(id);
        return component
          ? [{ __component: component.apiKey, ...sampleObject(component, lookup, depth + 1) }]
          : [];
      });
    default:
      return `<${field.type}>`;
  }
};

const sampleObject = (
  definition: SchemaDefinition,
  lookup: DefinitionLookup,
  depth: number,
): Record<string, unknown> =>
  depth > MAX_SAMPLE_DEPTH
    ? {}
    : Object.fromEntries(
        liveFields(definition).map((field) => [field.apiKey, sampleValue(field, lookup, depth)]),
      );

const SYSTEM_SAMPLE = {
  id: '<uuid>',
  locale: '<locale>',
  createdAt: '<datetime>',
  updatedAt: '<datetime>',
  publishedAt: '<datetime>',
};

/** An example delivery response (`GET /api/content/:routeKey`), as pretty JSON. */
export const restResponseSample = (definition: SchemaDefinition, lookup: DefinitionLookup): string => {
  const item = { ...SYSTEM_SAMPLE, ...sampleObject(definition, lookup, 0) };
  if (!isModelDefinition(definition)) {
    return JSON.stringify(sampleObject(definition, lookup, 0), null, 2);
  }
  const meta = { locale: '<locale>', snapshot: 0 };
  const body =
    definition.kind === 'collection'
      ? { data: [item], meta: { ...meta, pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } } }
      : { data: item, meta };
  return JSON.stringify(body, null, 2);
};

const listOf = (multiple: boolean, type: string) => (multiple ? `[${type}!]` : type);

const graphqlFieldType = (owner: SchemaDefinition, field: FieldDefinition, lookup: DefinitionLookup) => {
  const nameOf = (id: string) => {
    const target = lookup.get(id);
    return target ? toTypeName(target.apiKey) : 'JSON';
  };
  switch (field.type) {
    case 'number':
      return 'Float';
    case 'integer':
      return 'Int53';
    case 'boolean':
      return 'Boolean';
    case 'json':
      return 'JSON';
    case 'richtext':
      return 'RichText';
    case 'media':
      return listOf(field.settings.multiple, 'Media');
    case 'enum':
      return listOf(field.settings.multiple, `${toTypeName(owner.apiKey)}${toTypeName(field.apiKey)}Enum`);
    case 'relation':
      return listOf(field.settings.cardinality === 'many', nameOf(field.settings.target));
    case 'component':
      return listOf(field.settings.repeatable, nameOf(field.settings.component));
    case 'dynamiczone':
      return `[${toTypeName(owner.apiKey)}${toTypeName(field.apiKey)}Zone!]`;
    default:
      return 'String';
  }
};

const READ_ARGS =
  'locale: String, fallback: Boolean = true, publicationState: PublicationState = PUBLISHED, snapshot: Int';

/** The definition's GraphQL type and (for models) its root queries and mutations, as SDL. */
export const graphqlSdl = (definition: SchemaDefinition, lookup: DefinitionLookup): string => {
  const name = toTypeName(definition.apiKey);
  const system = isModelDefinition(definition)
    ? [
        'id: ID!',
        'locale: String!',
        'createdAt: String!',
        'updatedAt: String!',
        'publishedAt: String',
        `localizations: [${name}!]`,
      ]
    : [];
  const fields = liveFields(definition).map(
    (field) => `${field.apiKey}: ${graphqlFieldType(definition, field, lookup)}`,
  );
  const type = `type ${name} {\n${[...system, ...fields].map((line) => `  ${line}`).join('\n')}\n}`;
  if (!isModelDefinition(definition)) {
    return `${type}\n`;
  }
  const queries =
    definition.kind === 'collection'
      ? [
          `${definition.apiKey}(id: ID!, ${READ_ARGS}): ${name}`,
          `${collectionQueryName(definition)}(filter: ${name}Filter, sort: [${name}Sort!], search: String, page: Int, pageSize: Int, ${READ_ARGS}): ${name}Connection`,
        ]
      : [`${definition.apiKey}(${READ_ARGS}): ${name}`];
  const mutations = MUTATION_PREFIXES.map((prefix) => `${prefix}${name}`);
  return `${type}\n\ntype Query {\n${queries.map((line) => `  ${line}`).join('\n')}\n}\n\n# Mutations: ${mutations.join(', ')}\n`;
};
