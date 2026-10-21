import { describe, expect, it } from 'vitest';
import { serializeDefinition } from '../fileFormat/canonical.js';
import { schemaFilePath, scopeOfSchemaFilePath } from '../fileFormat/layout.js';
import { parseLockFile, serializeLockFile } from '../fileFormat/lockFile.js';
import { createDefinitionIndex } from '../inheritance/resolve.js';
import { normalizeDefinition } from '../normalize.js';
import { component, contract, field, id, model } from '../testing/fixtures.js';
import { ANY_TARGET, type SchemaDefinition } from '../types/definitions.js';
import { interfaceDeletionIssues } from './interfaces.js';
import { generatedNames } from './naming.js';
import { parseDefinition } from './parse.js';
import { validateSchema } from './schema.js';

const codes = (definitions: readonly SchemaDefinition[]) =>
  validateSchema(definitions).map((found) => `${found.definitionId ?? ''} ${found.path} ${found.code}`);

const featurable = contract({
  id: id(1),
  apiKey: 'featurable',
  label: 'Featurable',
  fields: [
    field({ id: id(11), apiKey: 'title', required: true, filterable: true, sortable: true }),
    field({ id: id(12), apiKey: 'summary', type: 'text' }),
  ],
  display: { titleFieldId: id(11), defaultSort: { fieldId: id(11), direction: 'asc' } },
});

const blogPost = model({
  id: id(2),
  apiKey: 'blogPost',
  pluralApiKey: 'blogPosts',
  implements: [id(1)],
  fields: [
    field({ id: id(21), apiKey: 'title', required: true, filterable: true, sortable: true }),
    field({ id: id(22), apiKey: 'summary', type: 'text' }),
    field({ id: id(23), apiKey: 'body', type: 'richtext' }),
  ],
});

describe('interface definitions', () => {
  it('normalizes: a plural is filled, implements is sorted and deduped, contract fields are canonical', () => {
    expect(featurable.pluralApiKey).toBe('featurables');
    const many = model({ id: id(3), apiKey: 'note', implements: [id(9), id(1), id(9)] });
    expect(many.implements).toEqual([id(1), id(9)]);
    expect(model({ id: id(4), apiKey: 'plain', implements: [] }).implements).toBeUndefined();
    const field0 = featurable.fields[0];
    expect(field0?.deprecated).toBe(false);
    expect(field0?.width).toBeUndefined();
    expect(field0?.defaultValue).toBeUndefined();
  });

  it('parses a pulled interface back (stored defaults are accepted)', () => {
    const parsed = parseDefinition(JSON.parse(JSON.stringify(featurable)));
    expect(parsed).toEqual({ ok: true, definition: featurable });
  });

  it('INVALID_INTERFACE_FIELD: editor, width, default value or deprecation on a contract field', () => {
    const raw = {
      kind: 'interface',
      apiKey: 'featurable',
      label: 'Featurable',
      fields: [
        { apiKey: 'a', label: 'A', type: 'string', editor: { id: 'textarea' } },
        { apiKey: 'b', label: 'B', type: 'string', width: 'half', defaultValue: 'x', deprecated: true },
      ],
    };
    const parsed = parseDefinition(raw);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.issues.map((found) => `${found.path} ${found.code}`)).toEqual([
      '/fields/0/editor INVALID_INTERFACE_FIELD',
      '/fields/1/width INVALID_INTERFACE_FIELD',
      '/fields/1/defaultValue INVALID_INTERFACE_FIELD',
      '/fields/1/deprecated INVALID_INTERFACE_FIELD',
    ]);
  });

  it('INVALID_INTERFACE_FIELD and UNSUPPORTED_FLAG: components, zones, unique and slug sources', () => {
    const parsed = parseDefinition({
      kind: 'interface',
      apiKey: 'featurable',
      label: 'Featurable',
      fields: [
        { id: id(31), apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: id(40) } },
        { id: id(32), apiKey: 'code', label: 'Code', type: 'string', unique: true },
        { id: id(33), apiKey: 'slug', label: 'Slug', type: 'slug', settings: { sourceFieldId: id(32) } },
      ],
    });
    expect(!parsed.ok && parsed.issues.map((found) => `${found.path} ${found.code}`)).toEqual([
      '/fields/0/type INVALID_INTERFACE_FIELD',
      '/fields/1/unique UNSUPPORTED_FLAG',
      '/fields/2/settings/sourceFieldId INVALID_INTERFACE_FIELD',
    ]);
  });

  it('round-trips through a schema file in interfaces/ and the lock file', () => {
    expect(schemaFilePath(featurable, null)).toBe('interfaces/featurable.json');
    expect(schemaFilePath(featurable, 'blog')).toBe('sites/blog/interfaces/featurable.json');
    expect(scopeOfSchemaFilePath('sites/blog/interfaces/featurable.json')).toEqual({ site: 'blog' });
    expect(parseDefinition(JSON.parse(serializeDefinition(blogPost)))).toEqual({
      ok: true,
      definition: blogPost,
    });
    const lock = {
      formatVersion: 2 as const,
      schemaVersion: 3,
      definitions: {
        [featurable.id]: {
          kind: 'interface' as const,
          apiKey: 'featurable',
          version: 1,
          hash: 'h',
          site: null,
        },
      },
    };
    expect(parseLockFile(serializeLockFile(lock))).toEqual(lock);
  });

  it('claims its plural in the shared namespace and GraphQL names with no mutations', () => {
    const posts = model({ id: id(5), apiKey: 'featurables' });
    expect(codes([featurable, posts])).toContain(`${id(5)} /apiKey API_KEY_COLLISION`);
    expect(generatedNames(featurable).map((name) => `${name.namespace}:${name.name}`)).toEqual([
      'type:Featurable',
      'type:FeaturableFilter',
      'type:FeaturableConnection',
      'type:FeaturableEdge',
      'type:FeaturableSort',
      'query:featurable',
      'query:featurables',
    ]);
  });
});

describe('checkInterfaces', () => {
  it('accepts a member that satisfies the contract', () => {
    expect(codes([featurable, blogPost])).toEqual([]);
  });

  it('UNKNOWN_INTERFACE: implements an interface that does not exist', () => {
    expect(codes([blogPost])).toEqual([`${id(2)} /implements/0 UNKNOWN_INTERFACE`]);
  });

  it('INVALID_INTERFACE: implements something that is not an interface', () => {
    const hero = component({ id: id(1), apiKey: 'hero' });
    expect(codes([hero, blogPost])).toEqual([`${id(2)} /implements/0 INVALID_INTERFACE`]);
  });

  it('INTERFACE_FIELD_MISSING: names the interface and the field, for the admin offer', () => {
    const lacking = { ...blogPost, fields: blogPost.fields.filter((own) => own.apiKey !== 'summary') };
    const [found, ...rest] = validateSchema([featurable, lacking]);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      definitionId: id(2),
      path: '/implements/0',
      code: 'INTERFACE_FIELD_MISSING',
      message: '"summary" is required by Featurable',
      interfaceId: id(1),
      fieldApiKey: 'summary',
    });
  });

  it('INTERFACE_FIELD_MISSING: a deprecated or renamed member field does not satisfy it', () => {
    const renamed = {
      ...blogPost,
      fields: blogPost.fields.map((own) => (own.id === id(21) ? { ...own, apiKey: 'headline' } : own)),
    };
    expect(codes([featurable, renamed])).toEqual([`${id(2)} /implements/0 INTERFACE_FIELD_MISSING`]);
    const deprecated = {
      ...blogPost,
      fields: blogPost.fields.map((own) => (own.id === id(22) ? { ...own, deprecated: true } : own)),
    };
    expect(codes([featurable, deprecated])).toEqual([`${id(2)} /implements/0 INTERFACE_FIELD_MISSING`]);
  });

  it('INTERFACE_FIELD_MISMATCH: type, flags, enum values and multiple, media kinds and multiple, relation', () => {
    const retyped = {
      ...blogPost,
      fields: blogPost.fields.map((own) => (own.id === id(22) ? { ...own, type: 'richtext' as const } : own)),
    } as SchemaDefinition;
    expect(codes([featurable, retyped])).toEqual([`${id(2)} /fields/1 INTERFACE_FIELD_MISMATCH`]);
    const unsortable = {
      ...blogPost,
      fields: blogPost.fields.map((own) => (own.id === id(21) ? { ...own, sortable: false } : own)),
    };
    const [flag] = validateSchema([featurable, unsortable]);
    expect(flag).toMatchObject({ code: 'INTERFACE_FIELD_MISMATCH', fieldApiKey: 'title' });
    expect(flag?.message).toBe('"title" must be sortable, as Featurable requires');

    const shaped = contract({
      id: id(6),
      apiKey: 'shaped',
      label: 'Shaped',
      fields: [
        field({
          id: id(61),
          apiKey: 'tone',
          type: 'enum',
          settings: { values: [{ value: 'a', label: 'A' }] },
        }),
        field({ id: id(62), apiKey: 'image', type: 'media', settings: { allowedKinds: ['image'] } }),
        field({
          id: id(63),
          apiKey: 'author',
          type: 'relation',
          settings: { target: id(2), cardinality: 'one' },
        }),
      ],
    });
    const member = model({
      id: id(7),
      apiKey: 'guide',
      implements: [id(6)],
      fields: [
        field({
          apiKey: 'tone',
          type: 'enum',
          settings: { values: [{ value: 'b', label: 'B' }], multiple: true },
        }),
        field({ apiKey: 'image', type: 'media', settings: { multiple: true } }),
        field({ apiKey: 'author', type: 'relation', settings: { target: id(2), cardinality: 'many' } }),
      ],
    });
    const messages = validateSchema([featurable, blogPost, shaped, member]).map((found) => found.message);
    expect(messages).toEqual([
      '"tone" must allow the values "a"; must allow one value only, as Shaped requires',
      '"image" must allow only image media; must allow one file only, as Shaped requires',
      '"author" must relate to one entry, as Shaped requires',
    ]);
  });

  it('a kind inherits implements, and its inherited fields satisfy the contract', () => {
    const guide = model({ id: id(8), apiKey: 'guide', extends: id(2) });
    const index = createDefinitionIndex([featurable, blogPost, guide]);
    expect(codes([featurable, blogPost, guide])).toEqual([]);
    expect(index.interfacesOf(id(8))).toEqual([id(1)]);
    expect(index.implementedBy(id(1))).toEqual([id(2), id(8)]);
    expect(index.memberFieldOf(id(1), id(11), id(8))?.id).toBe(id(21));
    expect(index.contractFieldsOf(id(8))).toEqual(
      new Map([
        [id(21), [id(1)]],
        [id(22), [id(1)]],
      ]),
    );
    // A kind declaring an interface checks its inherited fields, reported on its `implements` entry.
    const second = contract({
      id: id(9),
      apiKey: 'listable',
      fields: [field({ id: id(91), apiKey: 'title' })],
    });
    const strictSecond = contract({
      id: id(9),
      apiKey: 'listable',
      fields: [field({ id: id(91), apiKey: 'title', type: 'text' })],
    });
    expect(codes([featurable, blogPost, second, { ...guide, implements: [id(9)] }])).toEqual([]);
    expect(codes([featurable, blogPost, strictSecond, { ...guide, implements: [id(9)] }])).toEqual([
      `${id(8)} /implements/0 INTERFACE_FIELD_MISMATCH`,
    ]);
  });

  it('a singleton can be a member', () => {
    const about = model({
      id: id(10),
      apiKey: 'about',
      kind: 'singleton',
      implements: [id(1)],
      fields: [
        field({ apiKey: 'title', required: true, filterable: true, sortable: true }),
        field({ apiKey: 'summary', type: 'text' }),
      ],
    });
    expect(codes([featurable, about])).toEqual([]);
  });

  it('HAS_MEMBERS: an interface with members cannot be deleted', () => {
    const guide = model({ id: id(8), apiKey: 'guide', extends: id(2) });
    expect(interfaceDeletionIssues([featurable, blogPost, guide], id(1)).map((found) => found.code)).toEqual([
      'HAS_MEMBERS',
      'HAS_MEMBERS',
    ]);
    expect(interfaceDeletionIssues([featurable], id(1))).toEqual([]);
  });
});

describe('relation targets', () => {
  const relationTo = (target: string) =>
    model({
      id: id(20),
      apiKey: 'home',
      kind: 'singleton',
      fields: [field({ apiKey: 'featured', type: 'relation', settings: { target, cardinality: 'many' } })],
    });

  it('accepts a collection, an interface, or any entry', () => {
    expect(codes([featurable, blogPost, relationTo(id(2))])).toEqual([]);
    expect(codes([featurable, blogPost, relationTo(id(1))])).toEqual([]);
    expect(codes([featurable, blogPost, relationTo(ANY_TARGET)])).toEqual([]);
  });

  it('refuses a singleton or a component as a target, and a malformed target', () => {
    const about = model({ id: id(10), apiKey: 'about', kind: 'singleton' });
    expect(codes([about, relationTo(id(10))])).toEqual([
      `${id(20)} /fields/0/settings/target INVALID_REFERENCE_TARGET`,
    ]);
    const parsed = parseDefinition({
      ...normalizeDefinition({ ...relationTo(id(1)), fields: [] }),
      fields: [
        { apiKey: 'x', label: 'X', type: 'relation', settings: { target: 'any', cardinality: 'one' } },
      ],
    });
    expect(!parsed.ok && parsed.issues.map((found) => found.code)).toEqual(['INVALID_ID']);
  });
});
