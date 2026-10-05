import {
  generatedNames,
  normalizeDefinition,
  RESERVED_QUERY_NAMES,
  RESERVED_TYPE_NAMES,
  type DefinitionInput,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  assertValidSchema,
  getNamedType,
  isInputObjectType,
  isSpecifiedScalarType,
  printSchema,
  type GraphQLInputObjectType,
  type GraphQLObjectType,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { operatorsFor } from '../../../content/compiler/operators.js';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { operatorFieldName } from './fixedTypes.js';
import { buildGraphqlSchema } from './schemaBuilder.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const define = (input: DefinitionInput & { id: string }): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);

const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
  siteId: null,
});

const hero = define({
  id: uuid(1),
  kind: 'component',
  apiKey: 'hero',
  label: 'Hero',
  fields: [
    { id: uuid(11), apiKey: 'heading', label: 'Heading', type: 'string' },
    { id: uuid(12), apiKey: 'image', label: 'Image', type: 'media' },
  ],
});
const quote = define({
  id: uuid(2),
  kind: 'component',
  apiKey: 'quote',
  label: 'Quote',
  fields: [{ id: uuid(21), apiKey: 'text', label: 'Text', type: 'text' }],
});
const author = define({
  id: uuid(3),
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  fields: [{ id: uuid(31), apiKey: 'name', label: 'Name', type: 'string', required: true }],
});
const page = define({
  id: uuid(4),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  description: 'A page of the site',
  localized: true,
  fields: [
    {
      id: uuid(41),
      apiKey: 'title',
      label: 'Title',
      description: 'Shown in the browser tab',
      type: 'string',
      filterable: true,
      sortable: true,
    },
    { id: uuid(42), apiKey: 'body', label: 'Body', type: 'richtext' },
    { id: uuid(43), apiKey: 'views', label: 'Views', type: 'integer', sortable: true },
    { id: uuid(44), apiKey: 'score', label: 'Score', type: 'number' },
    { id: uuid(45), apiKey: 'price', label: 'Price', type: 'decimal', filterable: true },
    { id: uuid(46), apiKey: 'big', label: 'Big', type: 'biginteger' },
    { id: uuid(47), apiKey: 'live', label: 'Live', type: 'boolean' },
    { id: uuid(48), apiKey: 'day', label: 'Day', type: 'date' },
    { id: uuid(49), apiKey: 'at', label: 'At', type: 'datetime' },
    { id: uuid(50), apiKey: 'time', label: 'Time', type: 'time' },
    {
      id: uuid(51),
      apiKey: 'tone',
      label: 'Tone',
      type: 'enum',
      settings: { values: [{ value: 'calm', label: 'Calm' }] },
    },
    {
      id: uuid(52),
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: { multiple: true, values: [{ value: 'a', label: 'A' }] },
    },
    { id: uuid(53), apiKey: 'meta', label: 'Meta', type: 'json' },
    { id: uuid(54), apiKey: 'slug', label: 'Slug', type: 'slug' },
    { id: uuid(55), apiKey: 'cover', label: 'Cover', type: 'media' },
    { id: uuid(56), apiKey: 'photos', label: 'Photos', type: 'media', settings: { multiple: true } },
    {
      id: uuid(57),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: uuid(3), cardinality: 'one' },
    },
    {
      id: uuid(58),
      apiKey: 'related',
      label: 'Related',
      type: 'relation',
      settings: { target: uuid(4), cardinality: 'many' },
    },
    { id: uuid(59), apiKey: 'header', label: 'Header', type: 'component', settings: { component: uuid(1) } },
    {
      id: uuid(60),
      apiKey: 'quotes',
      label: 'Quotes',
      type: 'component',
      settings: { component: uuid(2), repeatable: true },
    },
    {
      id: uuid(61),
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [uuid(1), uuid(2)] },
    },
    { id: uuid(63), apiKey: 'old', label: 'Old', type: 'string', deprecated: true },
  ],
});
const home = define({
  id: uuid(5),
  kind: 'singleton',
  apiKey: 'home',
  label: 'Home',
  fields: [{ id: uuid(71), apiKey: 'headline', label: 'Headline', type: 'string' }],
});

const definitions = [hero, quote, author, page, home];
const snapshot = buildSnapshot(7, definitions.map(active), [
  { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
  { code: 'fr', label: 'French', isDefault: false, fallbacks: [] },
] as never);

describe('buildGraphqlSchema', () => {
  const { schema, version } = buildGraphqlSchema(snapshot);

  it('builds a valid schema keyed by the snapshot version', () => {
    expect(version).toBe(7);
    expect(() => assertValidSchema(schema)).not.toThrow();
  });

  it('uses only names from naming.ts (generated names and reserved fixed types)', () => {
    const generated = new Set(
      definitions
        .flatMap((definition) => generatedNames(definition))
        .map((name) => `${name.namespace}:${name.name}`),
    );
    const reserved = new Set(RESERVED_TYPE_NAMES);
    for (const [name, type] of Object.entries(schema.getTypeMap())) {
      if (name.startsWith('__') || isSpecifiedScalarType(type)) {
        continue;
      }
      expect(generated.has(`type:${name}`) || reserved.has(name), name).toBe(true);
    }
    for (const name of Object.keys(schema.getQueryType()?.getFields() ?? {})) {
      expect(generated.has(`query:${name}`) || RESERVED_QUERY_NAMES.includes(name), name).toBe(true);
    }
    for (const name of Object.keys(schema.getMutationType()?.getFields() ?? {})) {
      expect(generated.has(`mutation:${name}`), name).toBe(true);
    }
    expect(Object.keys(schema.getQueryType()?.getFields() ?? {})).toEqual([
      'author',
      'authors',
      'home',
      'page',
      'pages',
      '_schemaVersion',
      '_changes',
      '_snapshot',
      '_site',
    ]);
  });

  it('offers at least every operator the REST compiler allows on each field', () => {
    const filter = schema.getType('PageFilter') as GraphQLInputObjectType;
    for (const field of (page as ModelDefinition).fields.filter((candidate) => !candidate.deprecated)) {
      const allowed = operatorsFor(field);
      if (allowed.length === 0) {
        expect(filter.getFields()[field.apiKey], field.apiKey).toBeUndefined();
        continue;
      }
      const type = getNamedType(filter.getFields()[field.apiKey]?.type);
      expect(isInputObjectType(type), field.apiKey).toBe(true);
      const operators = Object.keys((type as GraphQLInputObjectType).getFields());
      for (const operator of allowed) {
        expect(operators, `${field.apiKey} ${operator}`).toContain(operatorFieldName(operator));
      }
    }
  });

  it('combines filters with and/or/not', () => {
    const filter = schema.getType('PageFilter') as GraphQLInputObjectType;
    expect(getNamedType(filter.getFields().and?.type)?.name).toBe('PageFilter');
    expect(getNamedType(filter.getFields().or?.type)?.name).toBe('PageFilter');
    expect(getNamedType(filter.getFields().not?.type)?.name).toBe('PageFilter');
  });

  it('maps every data type and hides deprecated fields', () => {
    const sdl = printSchema(schema);
    expect(sdl).toContain('body: RichText');
    expect(sdl).toContain('views: Int53');
    expect(sdl).toContain('variants: [MediaVariant!]!');
    expect(sdl).toContain('focalPoint: FocalPoint');
    expect(sdl).toContain('score: Float');
    expect(sdl).toContain('price: String');
    expect(sdl).toContain('tone: PageToneEnum');
    expect(sdl).toContain('tags: [PageTagsEnum!]');
    expect(sdl).toContain('cover: Media');
    expect(sdl).toContain('photos: [Media!]');
    expect(sdl).toContain('author: Author');
    expect(sdl).toContain('related: [Page!]');
    expect(sdl).toContain('header: Hero');
    expect(sdl).toContain('quotes: [Quote!]');
    expect(sdl).toContain('union PageSectionsZone = Hero | Quote');
    expect(sdl).toContain('input PageSectionsZoneInput');
    expect(sdl).toContain('localizations: [Page!]');
    expect(sdl).toContain('filter: PageFilter');
    expect(sdl).toContain('sort: [PageSort!]');
    expect(sdl).toMatch(/\bpages\(/);
    expect(sdl).not.toContain('pageCollection');
    expect(sdl).toMatch(/\bhome\(/);
    expect(sdl).not.toMatch(/\bhomes\(/);
    expect(sdl).not.toMatch(/\bold\b/);
    // Required fields stay nullable: a masked required field resolves to an error, not a null cascade.
    expect(sdl).toContain('name: String\n');
  });

  it('describes types and fields with their labels and help text (GraphiQL docs)', () => {
    const pageType = schema.getType('Page') as GraphQLObjectType;
    expect(pageType.description).toBe('Page\n\nA page of the site');
    expect(pageType.getFields().title?.description).toBe('Title\n\nShown in the browser tab');
    expect(pageType.getFields().views?.description).toBe('Views');
    expect((schema.getType('Hero') as GraphQLObjectType).description).toBe('Hero');
    expect((schema.getType('Hero') as GraphQLObjectType).getFields().heading?.description).toBe('Heading');
    const filter = schema.getType('PageFilter') as GraphQLInputObjectType;
    expect(filter.getFields().title?.description).toBe('Title\n\nShown in the browser tab');
    expect(printSchema(schema)).toContain(
      '"""\n  Title\n  \n  Shown in the browser tab\n  """\n  title: String',
    );
  });

  it('builds an empty schema before the first model exists', () => {
    const empty = buildGraphqlSchema(buildSnapshot(0, [], [])).schema;
    expect(() => assertValidSchema(empty)).not.toThrow();
    expect(Object.keys(empty.getQueryType()?.getFields() ?? {})).toEqual([
      '_schemaVersion',
      '_changes',
      '_snapshot',
      '_site',
    ]);
    expect(empty.getMutationType()).toBeUndefined();
  });
});
