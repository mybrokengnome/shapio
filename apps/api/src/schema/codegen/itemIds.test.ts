import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../snapshot.js';
import { generateOpenApi } from './openapi.js';
import { generateTypeScript } from './typescript.js';

/** Every component item carries its stable `id` in generated types and OpenAPI (plan item-ids). */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  siteId: null,
  version: 1,
  revisionId: id(999),
  hash: 'h',
  activatedAt: new Date(0),
});

const link = normalizeDefinition({
  id: id(1),
  kind: 'component',
  apiKey: 'link',
  label: 'Link',
  fields: [{ id: id(11), apiKey: 'url', label: 'URL', type: 'string' }],
} as never);
const empty = normalizeDefinition({
  id: id(2),
  kind: 'component',
  apiKey: 'spacer',
  label: 'Spacer',
  fields: [],
} as never);
const page = normalizeDefinition({
  id: id(3),
  kind: 'collection',
  apiKey: 'page',
  pluralApiKey: 'pages',
  label: 'Page',
  fields: [
    { id: id(31), apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: id(1) } },
    {
      id: id(32),
      apiKey: 'links',
      label: 'Links',
      type: 'component',
      settings: { component: id(1), repeatable: true },
    },
    {
      id: id(33),
      apiKey: 'blocks',
      label: 'Blocks',
      type: 'dynamiczone',
      settings: { components: [id(1), id(2)] },
    },
  ],
} as never);
const snapshot = buildSnapshot(1, [link, empty, page].map(active), []);

describe('TypeScript for component items', () => {
  const output = generateTypeScript(snapshot);

  it('gives every component output type a required id, and its input type an optional one', () => {
    expect(output).toMatch(/export type Link = \{\n.*\n {2}id: string;\n.*\n {2}url: string \| null;\n\};/);
    expect(output).toMatch(
      /export type LinkInput = \{\n.*\n {2}id\?: string \| null;\n.*\n {2}url\?: string \| null;\n\};/,
    );
  });

  it('gives a component with no fields an id too', () => {
    expect(output).toMatch(/export type Spacer = \{\n.*\n {2}id: string;\n\};/);
    expect(output).toMatch(/export type SpacerInput = \{\n.*\n {2}id\?: string \| null;\n\};/);
  });

  it('adds no id field to the entry types beyond the entry system fields', () => {
    const pageFields = output.slice(
      output.indexOf('export type PageFields'),
      output.indexOf('export type Page ='),
    );
    expect(pageFields).not.toContain('id');
    expect(output).toContain(
      '  blocks: Array<({ __component: "link" } & Link) | ({ __component: "spacer" } & Spacer)> | null;',
    );
  });
});

type Schema = { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
type OpenApi = { components: { schemas: Record<string, Schema> } };

describe('OpenAPI for component items', () => {
  const { schemas } = (generateOpenApi(snapshot, { serverUrl: 'http://x/', version: '0' }) as OpenApi)
    .components;

  it('requires id on component output schemas', () => {
    expect(schemas.Link?.properties?.id).toMatchObject({ type: 'string', pattern: '^[0-9A-Za-z]{12}$' });
    expect(schemas.Link?.properties?.id).not.toHaveProperty('format');
    expect(schemas.Link?.required).toEqual(['id', 'url']);
    expect(schemas.Spacer?.required).toEqual(['id']);
  });

  it('accepts an optional id on component input schemas, which allow no other unknown key', () => {
    expect(schemas.LinkInput?.properties?.id).toMatchObject({
      anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }],
    });
    expect(schemas.LinkInput?.required).toBeUndefined();
    expect(schemas.LinkInput?.additionalProperties).toBe(false);
  });

  it('leaves entry schemas as they were', () => {
    expect(Object.keys(schemas.PageInput?.properties ?? {})).toEqual(['hero', 'links', 'blocks']);
    expect(schemas.Page?.properties?.id).toEqual({ type: 'string', format: 'uuid' });
  });
});
