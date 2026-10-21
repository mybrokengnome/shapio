import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../snapshot.js';
import { generateOpenApi } from './openapi.js';
import { generateTypeScript } from './typescript.js';

/** OpenAPI and TypeScript for interfaces and relations to them or to any entry (plan interfaces, D10). */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({ kind: 'collection', label: String(input.apiKey), fields: [], ...input } as never);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  siteId: null,
  version: 1,
  revisionId: id(999),
  hash: 'h',
  activatedAt: new Date(0),
});
const title = (n: number) => ({
  id: id(n),
  apiKey: 'title',
  label: 'Title',
  type: 'string',
  required: true,
  sortable: true,
});

const featurable = define({
  id: id(1),
  kind: 'interface',
  apiKey: 'featurable',
  label: 'Featurable',
  fields: [title(11)],
});
const post = define({
  id: id(2),
  apiKey: 'post',
  pluralApiKey: 'posts',
  label: 'Post',
  implements: [id(1)],
  fields: [title(21)],
});
const guide = define({ id: id(3), apiKey: 'guide', pluralApiKey: 'guides', label: 'Guide', extends: id(2) });
const about = define({
  id: id(4),
  kind: 'singleton',
  apiKey: 'about',
  label: 'About',
  implements: [id(1)],
  fields: [title(41)],
});
const homepage = define({
  id: id(5),
  kind: 'singleton',
  apiKey: 'homepage',
  label: 'Homepage',
  fields: [
    {
      id: id(51),
      apiKey: 'featured',
      label: 'Featured',
      type: 'relation',
      settings: { target: id(1), cardinality: 'many' },
    },
    { id: id(52), apiKey: 'spotlight', label: 'Spotlight', type: 'relation', settings: { target: '*' } },
  ],
});
const snapshot = buildSnapshot(7, [featurable, post, guide, about, homepage].map(active), []);

describe('TypeScript for interfaces', () => {
  const output = generateTypeScript(snapshot);

  it('declares the contract and the union of its members, kinds included', () => {
    expect(output).toContain(
      'export type Featurable = EntrySystemFields & {\n  /** Title */\n  title: string | null;\n} & { __model: string; __kinds: readonly string[] };',
    );
    expect(output).toContain('export type FeaturableAny = About | Guide | Post;');
    expect(output).not.toContain('FeaturableInput');
  });

  it('types relations to an interface and to any entry', () => {
    expect(output).toContain('  featured: Array<Related<FeaturableAny>> | null;');
    expect(output).toContain('  spotlight: Related<AnyEntry> | null;');
    expect(output).toContain('export type AnyEntry = About | Guide | Homepage | Post;');
  });

  it('maps the interface’s API ID to its members and its route key', () => {
    expect(output).toContain('  featurable: FeaturableAny;');
    expect(output).toContain("  featurable: 'featurables';");
  });
});

describe('OpenAPI for interfaces', () => {
  const document = generateOpenApi(snapshot, { serverUrl: 'http://x/', version: '0' }) as {
    paths: Record<string, Record<string, { parameters?: Array<{ name: string }>; responses: unknown }>>;
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const { schemas } = document.components;

  it('has the contract, one of its members by __model, and any entry', () => {
    expect(schemas.Featurable).toMatchObject({
      properties: { id: { format: 'uuid' }, __model: { type: 'string' }, title: {} },
    });
    expect(schemas.FeaturableInput).toBeUndefined();
    expect(schemas.FeaturableAny).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/About' },
        { $ref: '#/components/schemas/Guide' },
        { $ref: '#/components/schemas/Post' },
      ],
      discriminator: {
        propertyName: '__model',
        mapping: {
          about: '#/components/schemas/About',
          guide: '#/components/schemas/Guide',
          post: '#/components/schemas/Post',
        },
      },
    });
    expect((schemas.AnyEntry?.oneOf as unknown[]).length).toBe(4);
  });

  it('a relation property is an ID or the populated member', () => {
    const properties = schemas.Homepage?.properties as Record<string, { anyOf: unknown[] }>;
    expect(properties.featured?.anyOf[0]).toMatchObject({
      type: 'array',
      items: { anyOf: [{ format: 'uuid' }, { $ref: '#/components/schemas/FeaturableAny' }] },
    });
    expect(properties.spotlight?.anyOf[0]).toMatchObject({
      anyOf: [{ format: 'uuid' }, { $ref: '#/components/schemas/AnyEntry' }],
    });
  });

  it('serves a read-only list and get under the plural, with meta.members', () => {
    const list = document.paths['/api/content/featurables'];
    expect(Object.keys(list ?? {})).toEqual(['get']);
    expect(JSON.stringify(list?.get?.responses)).toContain('#/components/schemas/InterfaceMember');
    expect(list?.get?.parameters?.map((parameter) => parameter.name)).toContain('q');
    expect(Object.keys(document.paths['/api/content/featurables/{id}'] ?? {})).toEqual(['get']);
    expect(document.paths['/api/admin/content/featurable']).toBeUndefined();
  });
});
