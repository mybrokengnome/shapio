import {
  BIGINTEGER_PATTERN,
  DECIMAL_PATTERN,
  isComponentDefinition,
  isModelDefinition,
  routeKeyOf,
  TIME_PATTERN,
  toTypeName,
  type FieldDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { operatorsFor } from '../../content/compiler/operators.js';
import { DEFAULT_RICH_TEXT_MODE, QUERY_LIMITS, RICH_TEXT_MODES } from '../../content/compiler/types.js';
import type { SchemaSnapshot } from '../snapshot.js';
import { snapshotPaths, SNAPSHOTS_TAG } from './openapiSnapshots.js';

/**
 * OpenAPI 3.1 for the active schema (build plan §3.10): generated in memory from the registry, never from
 * route source files, so a model change shows up in the document at once. Covers the delivery API and the
 * admin content API per model, with each model's entry, input and component schemas, plus the snapshot
 * routes (openapiSnapshots.ts).
 */
type JsonSchema = Record<string, unknown>;
type Mode = 'output' | 'input';

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const uuid: JsonSchema = { type: 'string', format: 'uuid' };

const describe = (field: FieldDefinition, schema: JsonSchema): JsonSchema => ({
  ...schema,
  ...(field.description || field.label ? { description: field.description ?? field.label } : {}),
});

const scalarSchema = (field: FieldDefinition): JsonSchema => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'slug':
    case 'uid':
      return {
        type: 'string',
        ...('minLength' in field.settings && field.settings.minLength !== undefined
          ? { minLength: field.settings.minLength }
          : {}),
        ...('maxLength' in field.settings && field.settings.maxLength !== undefined
          ? { maxLength: field.settings.maxLength }
          : {}),
      };
    case 'email':
      return { type: 'string', format: 'email' };
    case 'url':
      return { type: 'string', format: 'uri' };
    case 'number':
      return { type: 'number' };
    case 'integer':
      return { type: 'integer' };
    case 'decimal':
      return { type: 'string', pattern: DECIMAL_PATTERN.source };
    case 'biginteger':
      return { type: 'string', pattern: BIGINTEGER_PATTERN.source };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'time':
      return { type: 'string', pattern: TIME_PATTERN.source };
    case 'enum': {
      const values = { type: 'string', enum: field.settings.values.map((entry) => entry.value) };
      return field.settings.multiple ? { type: 'array', items: values, uniqueItems: true } : values;
    }
    default:
      return {};
  }
};

const listOr = (many: boolean, schema: JsonSchema): JsonSchema =>
  many ? { type: 'array', items: schema } : schema;

const fieldSchema = (field: FieldDefinition, snapshot: SchemaSnapshot, mode: Mode): JsonSchema => {
  const componentName = (id: string) => {
    const component = snapshot.byId.get(id)?.definition;
    return component ? `${toTypeName(component.apiKey)}${mode === 'input' ? 'Input' : ''}` : undefined;
  };
  switch (field.type) {
    case 'json':
      return {};
    case 'richtext':
      return ref(mode === 'output' ? 'RichTextOutput' : 'RichText');
    case 'media':
      return listOr(field.settings.multiple, mode === 'output' ? ref('MediaAsset') : uuid);
    case 'relation': {
      const target = snapshot.byId.get(field.settings.target)?.definition;
      const item =
        mode === 'output' && target
          ? {
              anyOf: [uuid, ref(toTypeName(target.apiKey))],
              description: 'An entry ID, or the entry when populated',
            }
          : uuid;
      return listOr(field.settings.cardinality === 'many', item);
    }
    case 'component': {
      const name = componentName(field.settings.component);
      return listOr(field.settings.repeatable, name ? ref(name) : { type: 'object' });
    }
    case 'dynamiczone': {
      const items = field.settings.components.flatMap((id) => {
        const component = snapshot.byId.get(id)?.definition;
        const name = componentName(id);
        return component && name
          ? [
              {
                allOf: [
                  ref(name),
                  {
                    type: 'object',
                    properties: { __component: { const: component.apiKey } },
                    required: ['__component'],
                  },
                ],
              },
            ]
          : [];
      });
      return { type: 'array', items: { oneOf: items } };
    }
    default:
      return scalarSchema(field);
  }
};

const liveFields = (definition: SchemaDefinition) => definition.fields.filter((field) => !field.deprecated);

const objectSchema = (
  definition: SchemaDefinition,
  snapshot: SchemaSnapshot,
  mode: Mode,
  system: Record<string, JsonSchema> = {},
): JsonSchema => {
  const properties: Record<string, JsonSchema> = { ...system };
  for (const field of liveFields(definition)) {
    const schema = describe(field, fieldSchema(field, snapshot, mode));
    properties[field.apiKey] = nullable(schema);
  }
  return {
    type: 'object',
    title: definition.label,
    ...(definition.description ? { description: definition.description } : {}),
    properties,
    ...(mode === 'output' ? { required: Object.keys(properties) } : { additionalProperties: false }),
  };
};

const SYSTEM_PROPERTIES: Record<string, JsonSchema> = {
  id: uuid,
  locale: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  publishedAt: { type: 'string', format: 'date-time' },
};

const COMMON_SCHEMAS: Record<string, JsonSchema> = {
  RichText: {
    type: 'object',
    description: 'Versioned rich-text document (ADR 0003): ProseMirror JSON in an envelope.',
    properties: { format: { const: 'shapio-richtext' }, version: { const: 1 }, doc: { type: 'object' } },
    required: ['format', 'version', 'doc'],
  },
  RichTextOutput: {
    type: 'object',
    description:
      'Rich text as delivered, per the `richText` query parameter: `doc` with `json` (the default), `html` with `html`, both with `both`.',
    properties: {
      format: { const: 'shapio-richtext' },
      version: { const: 1 },
      doc: { type: 'object' },
      html: { type: 'string', description: 'Sanitized HTML rendered from the JSON' },
    },
    required: ['format', 'version'],
  },
  MediaAsset: {
    type: 'object',
    properties: {
      id: uuid,
      filename: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      width: { type: ['integer', 'null'] },
      height: { type: ['integer', 'null'] },
      alt: { type: 'string' },
      caption: { type: 'string' },
      url: { type: 'string', description: 'Stable for public assets; signed and expiring for private ones' },
      urlExpiresAt: { type: ['string', 'null'], format: 'date-time' },
      variants: { type: 'array', items: { type: 'object' } },
    },
  },
  Pagination: {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      total: { type: 'integer' },
      pageCount: { type: 'integer' },
    },
  },
  Error: {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
        required: ['code', 'message'],
      },
    },
  },
};

const errorResponses = {
  '400': { description: 'Invalid query or body', content: { 'application/json': { schema: ref('Error') } } },
  '401': { description: 'Not authenticated', content: { 'application/json': { schema: ref('Error') } } },
  '403': {
    description: 'Not allowed (including filters on hidden fields)',
    content: { 'application/json': { schema: ref('Error') } },
  },
  '404': { description: 'Unknown model or entry', content: { 'application/json': { schema: ref('Error') } } },
};

const filterDescription = (model: ModelDefinition): string => {
  const lines = liveFields(model).flatMap((field) => {
    const operators = operatorsFor(field);
    return operators.length > 0 ? [`- \`${field.apiKey}\`: ${operators.join(' ')}`] : [];
  });
  return `Filter with \`filters[field][$op]=value\`; combine with \`$and\`, \`$or\`, \`$not\`. Ranges need a filterable or sortable field; text matches (\`$contains\`, \`$containsi\`, \`$startsWith\`, \`$endsWith\`) a filterable one.\n\n${lines.join('\n')}`;
};

const listParameters = (model: ModelDefinition, delivery: boolean) => [
  {
    name: 'filters',
    in: 'query',
    style: 'deepObject',
    explode: true,
    schema: { type: 'object' },
    description: filterDescription(model),
  },
  {
    name: 'sort',
    in: 'query',
    schema: { type: 'string' },
    description: 'Comma-separated `field:asc|desc` (sortable fields, `id`, `createdAt`, `updatedAt`)',
  },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  {
    name: 'pageSize',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: QUERY_LIMITS.maxPageSize },
  },
  { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search the title field' },
  ...itemParameters(delivery),
];

const itemParameters = (delivery: boolean) => [
  {
    name: 'fields',
    in: 'query',
    schema: { type: 'string' },
    description: 'Comma-separated fields to return',
  },
  {
    name: 'populate',
    in: 'query',
    schema: { type: 'string' },
    description: `Relations to expand: \`author,tags.author\` or \`*\` (at most ${QUERY_LIMITS.maxPopulateDepth} levels)`,
  },
  {
    name: 'locale',
    in: 'query',
    schema: { type: 'string' },
    description: 'Locale to serve; falls back along the locale chain',
  },
  ...(delivery
    ? [
        {
          name: 'snapshot',
          in: 'query',
          schema: { type: 'integer', minimum: 1 },
          description: 'Read content as of this publication sequence number (`meta.snapshot`)',
        },
        {
          name: 'richText',
          in: 'query',
          schema: { type: 'string', enum: [...RICH_TEXT_MODES], default: DEFAULT_RICH_TEXT_MODE },
          description: 'Rich-text shape: the JSON document, sanitized HTML rendered from it, or both',
        },
      ]
    : []),
];

const idParameter = { name: 'id', in: 'path', required: true, schema: uuid };
const json = (schema: JsonSchema, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * Delivery paths use the model's route key (`/api/content/articles`: the plural API ID of a collection, the
 * API ID of a singleton); admin paths use the API ID (`/api/admin/content/article`).
 */
const modelPaths = (model: ModelDefinition): Record<string, unknown> => {
  const name = toTypeName(model.apiKey);
  const routeKey = routeKeyOf(model);
  const tag = model.label;
  const meta = { type: 'object', properties: { locale: { type: 'string' }, snapshot: { type: 'integer' } } };
  const listMeta = { allOf: [meta, { type: 'object', properties: { pagination: ref('Pagination') } }] };
  const single = model.kind === 'singleton';
  const adminEntry = {
    type: 'object',
    properties: {
      id: uuid,
      locale: { type: 'string' },
      version: { type: 'integer' },
      status: { type: 'string', enum: ['draft', 'published', 'modified'] },
      data: ref(name),
    },
  };
  return {
    [`/api/content/${routeKey}`]: {
      get: {
        tags: [tag],
        summary: single ? `Read the published ${model.label}` : `List published ${model.label} entries`,
        operationId: `list${name}`,
        parameters: single ? itemParameters(true) : listParameters(model, true),
        responses: {
          '200': json({
            type: 'object',
            properties: single
              ? { data: ref(name), meta }
              : { data: { type: 'array', items: ref(name) }, meta: listMeta },
          }),
          '304': { description: 'Not modified (If-None-Match)' },
          ...errorResponses,
        },
      },
    },
    [`/api/content/${routeKey}/{id}`]: {
      get: {
        tags: [tag],
        summary: `Read one published ${model.label} entry`,
        operationId: `get${name}`,
        parameters: [idParameter, ...itemParameters(true)],
        responses: {
          '200': json({ type: 'object', properties: { data: ref(name), meta } }),
          '304': { description: 'Not modified' },
          ...errorResponses,
        },
      },
    },
    [`/api/admin/content/${model.apiKey}`]: {
      get: {
        tags: [tag],
        summary: `List ${model.label} drafts (admin)`,
        operationId: `adminList${name}`,
        parameters: listParameters(model, false),
        responses: {
          '200': json({
            type: 'object',
            properties: { items: { type: 'array', items: adminEntry }, pagination: ref('Pagination') },
          }),
          ...errorResponses,
        },
      },
      post: {
        tags: [tag],
        summary: `Create a ${model.label} entry (admin)`,
        operationId: `create${name}`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  locale: { type: 'string' },
                  publish: { type: 'boolean' },
                  data: ref(`${name}Input`),
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': json(adminEntry, 'Created'),
          '422': json(ref('Error'), 'Invalid content'),
          ...errorResponses,
        },
      },
    },
    [`/api/admin/content/${model.apiKey}/{id}`]: {
      get: {
        tags: [tag],
        summary: `Read a ${model.label} draft (admin)`,
        operationId: `adminGet${name}`,
        parameters: [idParameter, { name: 'locale', in: 'query', schema: { type: 'string' } }],
        responses: { '200': json(adminEntry), ...errorResponses },
      },
      put: {
        tags: [tag],
        summary: `Save a ${model.label} draft (admin; 409 when the expected version is stale)`,
        operationId: `update${name}`,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  locale: { type: 'string' },
                  expectedVersion: { type: ['integer', 'null'] },
                  autosave: { type: 'boolean' },
                  data: ref(`${name}Input`),
                },
                required: ['expectedVersion'],
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': json(adminEntry),
          '409': json(ref('Error'), 'Stale version'),
          '422': json(ref('Error'), 'Invalid content'),
          ...errorResponses,
        },
      },
      delete: {
        tags: [tag],
        summary: `Delete a ${model.label} entry (admin)`,
        operationId: `delete${name}`,
        parameters: [idParameter],
        responses: {
          '204': { description: 'Deleted' },
          '409': json(ref('Error'), 'Still referenced'),
          ...errorResponses,
        },
      },
    },
    [`/api/admin/content/${model.apiKey}/{id}/publish`]: {
      post: {
        tags: [tag],
        summary: `Publish locales of a ${model.label} entry (admin)`,
        operationId: `publish${name}`,
        parameters: [idParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { locales: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { '200': json(adminEntry), ...errorResponses },
      },
    },
    [`/api/admin/content/${model.apiKey}/{id}/unpublish`]: {
      post: {
        tags: [tag],
        summary: `Unpublish locales of a ${model.label} entry (admin)`,
        operationId: `unpublish${name}`,
        parameters: [idParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { locales: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { '200': json(adminEntry), ...errorResponses },
      },
    },
  };
};

export type OpenApiOptions = { serverUrl: string; version: string };

/** The OpenAPI document for a schema snapshot. */
export const generateOpenApi = (
  snapshot: SchemaSnapshot,
  options: OpenApiOptions,
): Record<string, unknown> => {
  const definitions = snapshot.definitions.map((active) => active.definition);
  const schemas: Record<string, JsonSchema> = { ...COMMON_SCHEMAS };
  for (const definition of definitions) {
    const name = toTypeName(definition.apiKey);
    schemas[name] = objectSchema(
      definition,
      snapshot,
      'output',
      isModelDefinition(definition) ? SYSTEM_PROPERTIES : {},
    );
    schemas[`${name}Input`] = objectSchema(definition, snapshot, 'input');
  }
  const models = definitions.filter(isModelDefinition);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Shapio content API',
      version: `${options.version}+schema.${snapshot.version}`,
      description: 'Generated from the active schema. Delivery reads return published content only.',
    },
    servers: [{ url: options.serverUrl }],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      ...models.map((model) => ({
        name: model.label,
        description: model.description ?? `${model.kind} \`${model.apiKey}\``,
      })),
      SNAPSHOTS_TAG,
    ],
    paths: Object.assign({}, ...models.map(modelPaths), snapshotPaths()),
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API token (`shp_…`): admin or delivery role',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'shapio_session',
          description: 'Admin session (mutations need X-CSRF-Token)',
        },
      },
    },
    'x-shapio-components': definitions.filter(isComponentDefinition).map((component) => component.apiKey),
  };
};
