import {
  ancestorChain,
  collectionQueryName,
  INTERFACE_TYPE_SUFFIX,
  isModelDefinition,
  MUTATION_PREFIXES,
  resolveModelDefinition,
  routePathOf,
  toTypeName,
  type FieldDefinition,
  type ModelDefinition,
  type ResolvedField,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * The API shapes a definition produces, derived from the registry naming helpers in `@shapio/schema`
 * (`routeKeyOf`, `toTypeName`, `collectionQueryName`, `MUTATION_PREFIXES`), the same names the server's
 * OpenAPI and GraphQL builders use. Previews of a definition being edited, before it exists on the server.
 * A kind (a model that extends another) is previewed with its inherited fields and its nested REST path.
 */
export type DefinitionLookup = ReadonlyMap<string, SchemaDefinition>;

/** Whether the definition is already resolved (`resolveModelDefinition` adds `ancestorIds`). */
const isResolved = (definition: SchemaDefinition) => 'ancestorIds' in definition;

/**
 * The definition as entries see it: a kind with its ancestors' fields first (`resolveModelDefinition`).
 * Idempotent: an already resolved definition (callers may pass one) is returned as it is.
 */
export const effectiveDefinition = (
  definition: SchemaDefinition,
  lookup: DefinitionLookup,
): SchemaDefinition =>
  isModelDefinition(definition) && definition.extends !== undefined && !isResolved(definition)
    ? resolveModelDefinition(definition, (id) => lookup.get(id))
    : definition;

/** The model's ancestors, root first (none for a root or a broken chain's missing part). */
const ancestorsOf = (definition: ModelDefinition, lookup: DefinitionLookup): ModelDefinition[] =>
  ancestorChain(definition, (id) => lookup.get(id)).ids.flatMap((id) => {
    const ancestor = lookup.get(id);
    return ancestor && isModelDefinition(ancestor) ? [ancestor] : [];
  });

export type RestEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  scope: 'delivery' | 'admin';
};

const liveFields = (definition: SchemaDefinition) => definition.fields.filter((field) => !field.deprecated);

export const restEndpoints = (
  definition: SchemaDefinition,
  lookup: DefinitionLookup = new Map(),
): RestEndpoint[] => {
  if (!isModelDefinition(definition)) {
    return [];
  }
  const delivery = `/api/content/${routePathOf(definition, ancestorsOf(definition, lookup))}`;
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
  __model: '<model API ID>',
  locale: '<locale>',
  createdAt: '<datetime>',
  updatedAt: '<datetime>',
  publishedAt: '<datetime>',
};

/** An example delivery response (`GET /api/content/:routeKey`), as pretty JSON. */
export const restResponseSample = (stored: SchemaDefinition, lookup: DefinitionLookup): string => {
  const definition = effectiveDefinition(stored, lookup);
  const item = { ...SYSTEM_SAMPLE, __model: definition.apiKey, ...sampleObject(definition, lookup, 0) };
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

const graphqlFieldType = (subject: SchemaDefinition, field: ResolvedField, lookup: DefinitionLookup) => {
  // Enum and zone types of an inherited field belong to the model that declares it.
  const owner = (field.inheritedFrom === undefined ? undefined : lookup.get(field.inheritedFrom)) ?? subject;
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

/** The interfaces a kind's type implements: each ancestor's (every ancestor has kinds), root first. */
const interfacesOf = (definition: SchemaDefinition, lookup: DefinitionLookup): string => {
  const ancestors = isModelDefinition(definition) ? ancestorsOf(definition, lookup) : [];
  return ancestors.length === 0
    ? ''
    : ` implements ${ancestors.map((ancestor) => `${toTypeName(ancestor.apiKey)}${INTERFACE_TYPE_SUFFIX}`).join(' & ')}`;
};

/** The definition's GraphQL type and (for models) its root queries and mutations, as SDL. */
export const graphqlSdl = (stored: SchemaDefinition, lookup: DefinitionLookup): string => {
  const definition = effectiveDefinition(stored, lookup);
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
  const body = [...system, ...fields].map((line) => `  ${line}`).join('\n');
  const type = `type ${name}${interfacesOf(definition, lookup)} {\n${body}\n}`;
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
