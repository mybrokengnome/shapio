import {
  BIGINTEGER_PATTERN,
  DECIMAL_PATTERN,
  isComponentDefinition,
  isInterfaceDefinition,
  isModelDefinition,
  isSeoField,
  routePathOf,
  TIME_PATTERN,
  toTypeName,
  type CodeLanguage,
  type FieldDefinition,
  type InterfaceDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { operatorsFor } from '../../content/compiler/operators.js';
import {
  DEFAULT_RICH_TEXT_MODE,
  PUBLICATION_STATES,
  QUERY_LIMITS,
  RICH_TEXT_MODES,
  SEO_MODES,
} from '../../content/compiler/types.js';
import { relationTargetOf } from '../../content/relationTarget.js';
import type { SchemaSnapshot } from '../snapshot.js';
import { sitePaths, SITE_TAG } from './openapiSite.js';
import { snapshotPaths, SNAPSHOTS_TAG } from './openapiSnapshots.js';

/**
 * OpenAPI 3.1 for the active schema (build plan §3.10): generated in memory from the registry, never from
 * route source files, so a model change shows up in the document at once. Covers the delivery API and the
 * admin content API per model, with each model's entry, input and component schemas, plus the snapshot
 * routes (openapiSnapshots.ts). Models are described with their effective fields (plan polymorphic-types):
 * a model that extends another is served under its ancestors' route key (`/api/content/products/digital`),
 * and a model with children reads, lists and is related to as `<Name>Any`, one of its family's schemas told
 * apart by `__model`, which every delivered entry carries. An interface (plan interfaces) has `<Name>` (its
 * contract), `<Name>Any` (one of its members' schemas) and a read-only list route under its plural; a relation
 * to any entry holds `AnyEntry`, one of every model's schemas.
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

/** The media type of a code field's language (OpenAPI 3.1 `contentMediaType`); plain text has none. */
const CODE_MEDIA_TYPES: Record<CodeLanguage, string | undefined> = {
  plain: undefined,
  html: 'text/html',
  css: 'text/css',
  javascript: 'text/javascript',
  json: 'application/json',
  yaml: 'application/yaml',
  markdown: 'text/markdown',
};

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
    case 'code':
      return {
        type: 'string',
        ...(field.settings.minLength !== undefined ? { minLength: field.settings.minLength } : {}),
        ...(field.settings.maxLength !== undefined ? { maxLength: field.settings.maxLength } : {}),
        'x-shapio-language': field.settings.language,
        ...(CODE_MEDIA_TYPES[field.settings.language]
          ? { contentMediaType: CODE_MEDIA_TYPES[field.settings.language] }
          : {}),
      };
    case 'enum': {
      const values = { type: 'string', enum: field.settings.values.map((entry) => entry.value) };
      return field.settings.multiple ? { type: 'array', items: values, uniqueItems: true } : values;
    }
    default:
      return {};
  }
};

/** The schema an entry of a model is delivered as: the family's `<Name>Any` when other models extend it. */
const entrySchemaName = (snapshot: SchemaSnapshot, id: string): string | undefined => {
  const definition = snapshot.byId.get(id)?.definition;
  if (!definition) {
    return undefined;
  }
  return snapshot.childrenOf(id).length > 0
    ? `${toTypeName(definition.apiKey)}Any`
    : toTypeName(definition.apiKey);
};

/**
 * One of some models' entry schemas, told apart by `__model` (the singular API ID): a family, an interface's
 * members, or every model. With no models it matches nothing (an interface nothing implements yet).
 */
const unionSchema = (snapshot: SchemaSnapshot, modelIds: readonly string[]): JsonSchema => {
  const members = modelIds.flatMap((memberId) => {
    const member = snapshot.byId.get(memberId)?.definition;
    return member && isModelDefinition(member)
      ? [{ apiKey: member.apiKey, name: toTypeName(member.apiKey) }]
      : [];
  });
  if (members.length === 0) {
    return { not: {}, description: 'No type implements it yet' };
  }
  return {
    oneOf: members.map((member) => ref(member.name)),
    discriminator: {
      propertyName: '__model',
      mapping: Object.fromEntries(
        members.map((member) => [member.apiKey, `#/components/schemas/${member.name}`]),
      ),
    },
  };
};

/** The schema a populated relation value is: its target model's, its interface's members', or any entry. */
const relatedSchemaName = (
  snapshot: SchemaSnapshot,
  field: FieldDefinition<'relation'>,
): string | undefined => {
  const target = relationTargetOf(snapshot, field);
  if (target.kind === 'any') {
    return 'AnyEntry';
  }
  if (target.kind === 'interface') {
    const definition = snapshot.byId.get(target.id)?.definition;
    return definition ? `${toTypeName(definition.apiKey)}Any` : undefined;
  }
  return entrySchemaName(snapshot, target.id);
};

/** Model IDs in API ID order: an interface's members and every model have no tree order of their own. */
const byApiKey = (snapshot: SchemaSnapshot, ids: readonly string[]): string[] =>
  [...ids].sort((a, b) =>
    (snapshot.byId.get(a)?.definition.apiKey ?? a).localeCompare(
      snapshot.byId.get(b)?.definition.apiKey ?? b,
    ),
  );

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
      const target = relatedSchemaName(snapshot, field);
      const item =
        mode === 'output' && target
          ? {
              anyOf: [uuid, ref(target)],
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
  Kind: {
    type: 'object',
    description: 'One kind of a family list (plan polymorphic-types)',
    properties: {
      apiKey: { type: 'string', description: 'The singular API ID' },
      label: { type: 'string' },
      parent: { type: ['string', 'null'], description: "The parent's singular API ID; null for the root" },
      routeKey: { type: 'string' },
    },
    required: ['apiKey', 'label', 'parent', 'routeKey'],
  },
  InterfaceMember: {
    type: 'object',
    description: 'One member type of an interface list (plan interfaces)',
    properties: {
      apiKey: { type: 'string', description: 'The singular API ID' },
      label: { type: 'string' },
      routeKey: { type: 'string', description: "The type's own delivery route key" },
    },
    required: ['apiKey', 'label', 'routeKey'],
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

/** What a list route's parameters are built from: a model, or an interface's contract. */
type Listed = ModelDefinition | InterfaceDefinition;

const filterDescription = (model: Listed): string => {
  const lines = liveFields(model).flatMap((field) => {
    const operators = operatorsFor(field);
    return operators.length > 0 ? [`- \`${field.apiKey}\`: ${operators.join(' ')}`] : [];
  });
  return `Filter with \`filters[field][$op]=value\`; combine with \`$and\`, \`$or\`, \`$not\`. Ranges need a filterable or sortable field; text matches (\`$contains\`, \`$containsi\`, \`$startsWith\`, \`$endsWith\`) a filterable one.\n\n${lines.join('\n')}`;
};

const listParameters = (model: Listed, delivery: boolean, seo = hasSeoField(model)) => [
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
  ...itemParameters(delivery, seo),
];

const hasSeoField = (definition: SchemaDefinition) =>
  definition.fields.some((field) => !field.deprecated && isSeoField(field));

/** `?seo=` is offered where it works: delivery reads of a model with an SEO field (or a member with one). */
const seoParameters = (seo: boolean) =>
  seo
    ? [
        {
          name: 'seo',
          in: 'query',
          schema: { type: 'string', enum: [...SEO_MODES], default: 'raw' },
          description:
            "SEO fields as stored (`raw`) or merged with the site's SEO defaults (`resolved`): the title through the site's title template (the entry's own title when empty), description and image from the defaults, `noindex` a boolean. A pinned `snapshot` uses today's defaults.",
        },
      ]
    : [];

const itemParameters = (delivery: boolean, seo: boolean) => [
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
        {
          name: 'publicationState',
          in: 'query',
          schema: { type: 'string', enum: [...PUBLICATION_STATES], default: 'published' },
          description:
            'Drafts mode: `draft` reads saved drafts instead of published content. Needs a delivery token whose role grants Read drafts (or an admin user); responses are never cached. Cannot be combined with `snapshot`.',
        },
        ...seoParameters(seo),
      ]
    : []),
];

const idParameter = { name: 'id', in: 'path', required: true, schema: uuid };
const json = (schema: JsonSchema, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

const ancestorsOf = (snapshot: SchemaSnapshot, id: string): ModelDefinition[] =>
  snapshot.ancestors(id).flatMap((ancestorId) => {
    const ancestor = snapshot.byId.get(ancestorId)?.definition;
    return ancestor && isModelDefinition(ancestor) ? [ancestor] : [];
  });

/**
 * Delivery paths use the model's route key (`/api/content/articles`: the plural API ID of a collection, the
 * API ID of a singleton, under its ancestors' for a model that extends another: `/api/content/products/digital`);
 * admin paths use the API ID (`/api/admin/content/article`). A model with children lists and reads any kind
 * of its family (`<Name>Any`).
 */
const modelPaths = (model: ModelDefinition, snapshot: SchemaSnapshot): Record<string, unknown> => {
  const name = toTypeName(model.apiKey);
  const routeKey = routePathOf(model, ancestorsOf(snapshot, model.id));
  const delivered = entrySchemaName(snapshot, model.id) ?? name;
  const tag = model.label;
  const meta = {
    type: 'object',
    properties: {
      locale: { type: 'string' },
      snapshot: { type: ['integer', 'null'], description: 'null on draft reads, which cannot be pinned' },
      publicationState: { type: 'string', enum: ['draft'], description: 'Present on draft reads only' },
    },
  };
  // A model with kinds lists its family; `kinds` names the kinds the caller may read, in tree order.
  const kinds =
    snapshot.childrenOf(model.id).length > 0 ? { kinds: { type: 'array', items: ref('Kind') } } : {};
  const listMeta = {
    allOf: [meta, { type: 'object', properties: { pagination: ref('Pagination'), ...kinds } }],
  };
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
        parameters: single ? itemParameters(true, hasSeoField(model)) : listParameters(model, true),
        responses: {
          '200': json({
            type: 'object',
            properties: single
              ? { data: ref(delivered), meta }
              : { data: { type: 'array', items: ref(delivered) }, meta: listMeta },
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
        parameters: [idParameter, ...itemParameters(true, hasSeoField(model))],
        responses: {
          '200': json({ type: 'object', properties: { data: ref(delivered), meta } }),
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
            properties: {
              items: { type: 'array', items: adminEntry },
              pagination: ref('Pagination'),
              ...kinds,
            },
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
        summary: `Publish locales of a ${model.label} entry (admin; 409 when the expected version is stale)`,
        operationId: `publish${name}`,
        parameters: [idParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  locales: { type: 'array', items: { type: 'string' } },
                  expectedVersion: { type: 'integer' },
                  expectedVersions: { type: 'object', additionalProperties: { type: 'integer' } },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': json(adminEntry),
          '409': json(ref('Error'), 'Stale version'),
          ...errorResponses,
        },
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

/**
 * An interface's delivery routes (plan interfaces, D6): its list over every member the caller may read
 * (`meta.members` names them) and one entry by ID, each entry in its own type's shape. Read-only: an entry is
 * written through its own type's route.
 */
const interfacePaths = (
  definition: InterfaceDefinition,
  snapshot: SchemaSnapshot,
): Record<string, unknown> => {
  const name = toTypeName(definition.apiKey);
  const tag = definition.label;
  const seo = snapshot.implementedBy(definition.id).some((memberId) => {
    const member = snapshot.resolve(memberId);
    return member !== undefined && hasSeoField(member);
  });
  const meta = {
    type: 'object',
    properties: {
      locale: { type: 'string' },
      snapshot: { type: ['integer', 'null'], description: 'null on draft reads, which cannot be pinned' },
      publicationState: { type: 'string', enum: ['draft'], description: 'Present on draft reads only' },
    },
  };
  const listMeta = {
    allOf: [
      meta,
      {
        type: 'object',
        properties: {
          pagination: ref('Pagination'),
          members: {
            type: 'array',
            items: ref('InterfaceMember'),
            description: 'The member types the caller may read',
          },
        },
      },
    ],
  };
  return {
    [`/api/content/${definition.pluralApiKey}`]: {
      get: {
        tags: [tag],
        summary: `List published entries of every ${definition.label} type`,
        operationId: `list${name}`,
        parameters: listParameters(definition, true, seo),
        responses: {
          '200': json({
            type: 'object',
            properties: { data: { type: 'array', items: ref(`${name}Any`) }, meta: listMeta },
          }),
          '304': { description: 'Not modified (If-None-Match)' },
          ...errorResponses,
        },
      },
    },
    [`/api/content/${definition.pluralApiKey}/{id}`]: {
      get: {
        tags: [tag],
        summary: `Read one published entry of any ${definition.label} type`,
        operationId: `get${name}`,
        parameters: [idParameter, ...itemParameters(true, seo)],
        responses: {
          '200': json({ type: 'object', properties: { data: ref(`${name}Any`), meta } }),
          '304': { description: 'Not modified' },
          ...errorResponses,
        },
      },
    },
  };
};

export type OpenApiOptions = { serverUrl: string; version: string };

/** The singular API IDs of a model's lineage, root first. */
const kindLineageOf = (snapshot: SchemaSnapshot, modelId: string): string[] =>
  [...snapshot.ancestors(modelId), modelId].flatMap((id) => {
    const apiKey = snapshot.byId.get(id)?.definition.apiKey;
    return apiKey === undefined ? [] : [apiKey];
  });

/** The OpenAPI document for a schema snapshot. */
export const generateOpenApi = (
  snapshot: SchemaSnapshot,
  options: OpenApiOptions,
): Record<string, unknown> => {
  // Models with their effective fields (inherited first); components and interfaces as they are.
  const definitions = snapshot.definitions.map(
    (active): SchemaDefinition => snapshot.resolve(active.definition.id) ?? active.definition,
  );
  const schemas: Record<string, JsonSchema> = { ...COMMON_SCHEMAS };
  for (const definition of definitions) {
    const name = toTypeName(definition.apiKey);
    if (isInterfaceDefinition(definition)) {
      // The contract (what every member has) and one of the members' own schemas; nothing is written as it.
      schemas[name] = objectSchema(definition, snapshot, 'output', {
        ...SYSTEM_PROPERTIES,
        __model: { type: 'string', description: "The API ID of the entry's type" },
        __kinds: {
          type: 'array',
          items: { type: 'string' },
          description: "The API IDs of the entry's type and the types it extends, root first",
        },
      });
      schemas[`${name}Any`] = unionSchema(
        snapshot,
        byApiKey(snapshot, snapshot.implementedBy(definition.id)),
      );
      continue;
    }
    schemas[name] = objectSchema(
      definition,
      snapshot,
      'output',
      isModelDefinition(definition)
        ? {
            ...SYSTEM_PROPERTIES,
            __model: {
              type: 'string',
              const: definition.apiKey,
              description: "The API ID of the entry's type",
            },
            __kinds: {
              type: 'array',
              items: { type: 'string' },
              const: kindLineageOf(snapshot, definition.id),
              description: "The API IDs of the entry's type and the types it extends, root first",
            },
          }
        : {},
    );
    schemas[`${name}Input`] = objectSchema(definition, snapshot, 'input');
    if (isModelDefinition(definition) && snapshot.childrenOf(definition.id).length > 0) {
      schemas[`${name}Any`] = unionSchema(snapshot, snapshot.family(definition.id));
    }
  }
  const models = definitions.filter(isModelDefinition);
  const interfaces = definitions.filter(isInterfaceDefinition);
  schemas.AnyEntry = unionSchema(
    snapshot,
    byApiKey(
      snapshot,
      models.map((model) => model.id),
    ),
  );
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
      ...interfaces.map((contract) => ({
        name: contract.label,
        description: contract.description ?? `interface \`${contract.apiKey}\``,
      })),
      SNAPSHOTS_TAG,
      SITE_TAG,
    ],
    paths: Object.assign(
      {},
      ...models.map((model) => modelPaths(model, snapshot)),
      ...interfaces.map((contract) => interfacePaths(contract, snapshot)),
      snapshotPaths(),
      sitePaths(),
    ),
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
