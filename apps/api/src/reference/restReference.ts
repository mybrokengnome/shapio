import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  hashDefinition,
  routeKeyOf,
  toTypeName,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { generateOpenApi } from '../schema/codegen/openapi.js';
import { buildSnapshot } from '../schema/snapshot.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';

/**
 * Generates documentation/reference/rest-api.md: the OpenAPI document Shapio generates for a schema, rendered
 * for the example site's `article` model (apps/example-site/shapio/). Every instance serves its own,
 * complete document at /api/docs; this page shows what one model's routes look like. `reference.test.ts`
 * fails when the page and the generator drift apart.
 */
const EXAMPLE_SCHEMA_DIR = resolve(import.meta.dirname, '../../../example-site/shapio');
const SAMPLE_MODEL = 'article';
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
};
type Operation = {
  summary?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
  responses?: Record<string, { description?: string }>;
};

const readDefinitions = (): SchemaDefinition[] =>
  ['models', 'components'].flatMap((kind) =>
    readdirSync(join(EXAMPLE_SCHEMA_DIR, kind))
      .filter((name) => name.endsWith('.json'))
      .sort()
      // Read like stored definitions, so a file without a plural API ID gets the derived one.
      .map((name) =>
        readStoredDefinition(JSON.parse(readFileSync(join(EXAMPLE_SCHEMA_DIR, kind, name), 'utf8'))),
      ),
  );

const exampleOpenApi = async () => {
  const definitions = readDefinitions();
  const actives = await Promise.all(
    definitions.map(async (definition) => ({
      definition,
      version: 1,
      revisionId: ZERO_UUID,
      hash: await hashDefinition(definition),
      activatedAt: new Date(0),
    })),
  );
  const snapshot = buildSnapshot(1, actives, [
    { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
    { code: 'fr', label: 'Français', isDefault: false, fallbacks: ['en'] },
  ]);
  return generateOpenApi(snapshot, { serverUrl: 'https://cms.example.com', version: 'current' }) as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }> };
  };
};

/** A schema keyword that should be a string (anything else renders as nothing). */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

const typeOf = (schema: Record<string, unknown> | undefined): string => {
  if (!schema) {
    return '';
  }
  if (typeof schema.$ref === 'string') {
    return schema.$ref.replace('#/components/schemas/', '');
  }
  if (Array.isArray(schema.anyOf)) {
    return (schema.anyOf as Array<Record<string, unknown>>).map(typeOf).join(' or ');
  }
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).map((value) => `\`${String(value)}\``).join(', ');
  }
  if (schema.type === 'array') {
    return `array of ${typeOf(schema.items as Record<string, unknown>)}`;
  }
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : text(schema.type) || 'object';
  return schema.format ? `${type} (${text(schema.format)})` : type;
};

const renderOperation = (method: string, path: string, operation: Operation): string[] => {
  const lines = ['', `### ${method.toUpperCase()} ${path}`, '', `${operation.summary ?? ''}.`];
  if (operation.parameters?.length) {
    lines.push('', '| Parameter | In | Type | Description |', '| --- | --- | --- | --- |');
    for (const parameter of operation.parameters) {
      lines.push(
        `| \`${parameter.name}\`${parameter.required ? ' (required)' : ''} | ${parameter.in} | ${cell(typeOf(parameter.schema))} | ${cell(parameter.description ?? '')} |`,
      );
    }
  }
  const body = operation.requestBody?.content?.['application/json']?.schema as
    { properties?: Record<string, Record<string, unknown>> } | undefined;
  if (body?.properties) {
    lines.push(
      '',
      `Body: ${Object.entries(body.properties)
        .map(([name, schema]) => `\`${name}\` (${typeOf(schema)})`)
        .join(', ')}.`,
    );
  }
  const responses = Object.entries(operation.responses ?? {}).map(([status, response]) =>
    `${status} ${response.description ?? ''}`.trim(),
  );
  lines.push('', `Responses: ${responses.join('; ')}.`);
  return lines;
};

export const renderRestReference = async (): Promise<string> => {
  const document = await exampleOpenApi();
  const name = toTypeName(SAMPLE_MODEL);
  const sample = readDefinitions().find(
    (definition) => definition.apiKey === SAMPLE_MODEL,
  ) as ModelDefinition;
  const routeKey = routeKeyOf(sample);
  // The sample model's routes, plus the model-independent snapshot routes.
  const samplePaths = [`/api/content/${routeKey}`, `/api/admin/content/${SAMPLE_MODEL}`, '/api/snapshots'];
  const lines = [
    '# REST API reference',
    '',
    '<!-- Generated from Shapio’s OpenAPI generator for the example site’s schema by `pnpm docs:reference`. Do not edit by hand. -->',
    '',
    'Shapio has no route per model in its code: every model is served by the same generic routes,',
    '`/api/content/:modelKey` (delivery) and `/api/admin/content/:modelKey` (admin), resolved through the schema',
    'registry at request time. The OpenAPI 3.1 document is generated from the active schema in memory, so it is',
    'always current: your instance serves it to admins at `/api/docs` (HTML) and `/api/docs/openapi.json`.',
    '',
    'The two APIs name a model differently. Delivery (and preview) addresses it by its **route key**: the',
    '**plural API ID** of a collection (`/api/content/articles`), the API ID of a singleton',
    '(`/api/content/homepage`). The admin content API always uses the **API ID** (`/api/admin/content/article`),',
    'for collections and singletons alike.',
    '',
    `Below are the routes generated for the \`${SAMPLE_MODEL}\` collection (plural API ID \`${routeKey}\`) of the`,
    '[example site](../example-site.md) (`apps/example-site/shapio/models/article.json`). Every other model gets',
    'the same set under its own API IDs.',
    'Usage, filters and examples are in the [delivery API guide](../delivery-api.md).',
    '',
    `## The \`${name}\` entry`,
    '',
    'What delivery returns for one entry (system attributes first, then every readable field):',
    '',
    '| Property | Type | Description |',
    '| --- | --- | --- |',
  ];
  for (const [property, schema] of Object.entries(document.components.schemas[name]?.properties ?? {})) {
    lines.push(`| \`${property}\` | ${cell(typeOf(schema))} | ${cell(text(schema.description))} |`);
  }
  lines.push('', '## Routes');
  for (const [path, operations] of Object.entries(document.paths)) {
    if (!samplePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      continue;
    }
    for (const [method, operation] of Object.entries(operations)) {
      lines.push(...renderOperation(method, path, operation));
    }
  }
  return `${lines.join('\n')}\n`;
};
