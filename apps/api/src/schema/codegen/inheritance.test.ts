import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../snapshot.js';
import { generateOpenApi } from './openapi.js';
import { generateTypeScript } from './typescript.js';

/** OpenAPI and TypeScript for a family of types (plan polymorphic-types D12). */

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

const post = define({
  id: id(1),
  apiKey: 'post',
  pluralApiKey: 'posts',
  label: 'Post',
  fields: [{ id: id(11), apiKey: 'title', label: 'Title', type: 'string' }],
});
const guide = define({
  id: id(2),
  apiKey: 'guide',
  pluralApiKey: 'guides',
  label: 'Guide',
  extends: id(1),
  fields: [{ id: id(21), apiKey: 'level', label: 'Level', type: 'integer' }],
});
const opinion = define({
  id: id(3),
  apiKey: 'opinion',
  pluralApiKey: 'opinions',
  label: 'Opinion',
  extends: id(1),
});
const reading = define({
  id: id(4),
  apiKey: 'reading',
  pluralApiKey: 'readings',
  label: 'Reading',
  fields: [
    { id: id(41), apiKey: 'post', label: 'Post', type: 'relation', settings: { target: id(1) } },
    { id: id(42), apiKey: 'guide', label: 'Guide', type: 'relation', settings: { target: id(2) } },
  ],
});
const snapshot = buildSnapshot(3, [post, guide, opinion, reading].map(active), []);

describe('TypeScript for a family', () => {
  const output = generateTypeScript(snapshot);

  it('builds a child on its parent’s fields and tags every type with its __model', () => {
    expect(output).toContain('export type PostFields = EntrySystemFields & {');
    expect(output).toMatch(/export type GuideFields = PostFields & \{\n.*\n {2}level: number \| null;\n\};/);
    expect(output).toContain(
      `export type Guide = GuideFields & { __model: "guide"; __kinds: readonly ["post", "guide"] };`,
    );
    expect(output).toContain(
      `export type Post = PostFields & { __model: "post"; __kinds: readonly ["post"] };`,
    );
    expect(output).toContain('export type GuideInput = PostInput & {');
    // The child's own type does not repeat inherited fields.
    expect(
      output.slice(output.indexOf('export type GuideFields'), output.indexOf('export type Guide =')),
    ).not.toContain('title');
  });

  it('unions a family as <Name>Any and uses it for relations and the parent’s entries', () => {
    expect(output).toContain('export type PostAny = Post | Guide | Opinion;');
    expect(output).not.toContain('GuideAny');
    expect(output).toContain('  post: Related<PostAny> | null;');
    expect(output).toContain('  guide: Related<Guide> | null;');
    expect(output).toContain('  post: PostAny;');
    expect(output).toContain('  guide: Guide;');
  });

  it('maps route keys to nested paths', () => {
    expect(output).toContain("  guide: 'posts/guides';");
    expect(output).toContain("  post: 'posts';");
  });
});

type OpenApi = {
  paths: Record<
    string,
    { get?: { responses: Record<string, { content: Record<string, { schema: unknown }> }> } }
  >;
  components: {
    schemas: Record<
      string,
      { properties?: Record<string, unknown>; oneOf?: unknown; discriminator?: unknown }
    >;
  };
};

describe('OpenAPI for a family', () => {
  const document = generateOpenApi(snapshot, {
    serverUrl: 'https://cms.example.com',
    version: 'test',
  }) as OpenApi;
  const { schemas } = document.components;

  it('describes a child with its effective fields and every entry with __model', () => {
    expect(Object.keys(schemas.Guide?.properties ?? {})).toEqual(
      expect.arrayContaining(['__model', 'title', 'level']),
    );
    expect(schemas.Guide?.properties?.__model).toMatchObject({ type: 'string', const: 'guide' });
    expect(schemas.Post?.properties?.__model).toMatchObject({ const: 'post' });
    expect(schemas.Guide?.properties?.__kinds).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      const: ['post', 'guide'],
    });
  });

  it('describes meta.kinds on the lists of a type with kinds only', () => {
    const listSchema = (path: string) =>
      JSON.stringify(document.paths[path]?.get?.responses['200']?.content['application/json']?.schema);
    expect(listSchema('/api/content/posts')).toContain(
      '"kinds":{"type":"array","items":{"$ref":"#/components/schemas/Kind"}}',
    );
    expect(listSchema('/api/content/posts/guides')).not.toContain('"kinds"');
    expect(listSchema('/api/admin/content/post')).toContain('#/components/schemas/Kind');
    expect(schemas.Kind?.properties).toHaveProperty('routeKey');
  });

  it('lists and reads a parent as one of its family, told apart by __model', () => {
    expect(schemas.PostAny).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/Post' },
        { $ref: '#/components/schemas/Guide' },
        { $ref: '#/components/schemas/Opinion' },
      ],
      discriminator: {
        propertyName: '__model',
        mapping: {
          post: '#/components/schemas/Post',
          guide: '#/components/schemas/Guide',
          opinion: '#/components/schemas/Opinion',
        },
      },
    });
    const list =
      document.paths['/api/content/posts']?.get?.responses['200']?.content['application/json']?.schema;
    expect(JSON.stringify(list)).toContain('#/components/schemas/PostAny');
    expect(schemas.GuideAny).toBeUndefined();
  });

  it('serves a child under its parent’s route key and relates to a parent as any kind', () => {
    expect(document.paths['/api/content/posts/guides']).toBeDefined();
    expect(document.paths['/api/content/posts/guides/{id}']).toBeDefined();
    expect(document.paths['/api/content/guides']).toBeUndefined();
    expect(document.paths['/api/admin/content/guide']).toBeDefined();
    expect(JSON.stringify(schemas.Reading?.properties?.post)).toContain('#/components/schemas/PostAny');
  });
});
