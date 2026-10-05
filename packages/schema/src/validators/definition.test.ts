import { describe, expect, it } from 'vitest';
import { component, field, id, model } from '../testing/fixtures.js';
import type { FieldInput, ModelDefinition } from '../types/definitions.js';
import { validateDefinition } from './definition.js';
import { parseDefinition } from './parse.js';

const codesFor = (...fields: Parameters<typeof field>[0][]) =>
  validateDefinition(model({ fields: fields.map(field) })).map((found) => `${found.path} ${found.code}`);

const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];

describe('validateDefinition', () => {
  it('accepts a definition using every data type with its default editor', () => {
    const hero = component({ id: id(900) });
    const definition = model({
      fields: [
        field({
          apiKey: 'title',
          type: 'string',
          required: true,
          unique: true,
          filterable: true,
          sortable: true,
        }),
        field({ apiKey: 'body', type: 'text' }),
        field({ apiKey: 'content', type: 'richtext' }),
        field({ apiKey: 'rating', type: 'number', settings: settings({ min: 0, max: 5 }) }),
        field({ apiKey: 'count', type: 'integer' }),
        field({ apiKey: 'price', type: 'decimal', settings: settings({ precision: 10, scale: 2 }) }),
        field({ apiKey: 'big', type: 'biginteger' }),
        field({ apiKey: 'flag', type: 'boolean' }),
        field({ apiKey: 'day', type: 'date' }),
        field({ apiKey: 'at', type: 'datetime' }),
        field({ apiKey: 'clock', type: 'time' }),
        field({
          apiKey: 'tone',
          type: 'enum',
          settings: settings({ values: [{ value: 'warm', label: 'Warm' }] }),
        }),
        field({ apiKey: 'meta', type: 'json' }),
        field({ apiKey: 'slug', type: 'slug' }),
        field({ apiKey: 'mail', type: 'email' }),
        field({ apiKey: 'site', type: 'url' }),
        field({ apiKey: 'ref', type: 'uid' }),
        field({ apiKey: 'cover', type: 'media' }),
        field({
          apiKey: 'author',
          type: 'relation',
          settings: settings({ target: id(901), cardinality: 'one' }),
        }),
        field({ apiKey: 'hero', type: 'component', settings: settings({ component: hero.id }) }),
        field({ apiKey: 'sections', type: 'dynamiczone', settings: settings({ components: [hero.id] }) }),
      ],
    });
    expect(validateDefinition(definition)).toEqual([]);
  });

  it('rejects a definition ID that is not a UUID', () => {
    expect(validateDefinition(model({ id: 'page-1' })).map((found) => found.code)).toContain('INVALID_ID');
  });

  it('rejects invalid definition and field API keys', () => {
    expect(validateDefinition(model({ apiKey: 'blog-post' })).map((found) => found.code)).toEqual([
      'API_KEY_INVALID',
    ]);
    expect(codesFor({ apiKey: '2nd' })).toEqual(['/fields/0/apiKey API_KEY_INVALID']);
    expect(codesFor({ apiKey: '__secret' })).toEqual(['/fields/0/apiKey API_KEY_RESERVED_PREFIX']);
  });

  it.each(['id', 'locale', 'localizations', 'Status', 'createdAt', 'publishedAt', 'and', 'Or', 'not'])(
    'rejects the system field name %s',
    (apiKey) => {
      expect(codesFor({ apiKey })).toEqual(['/fields/0/apiKey API_KEY_RESERVED']);
    },
  );

  it('checks the plural API ID of a collection', () => {
    const pathsAndCodes = (pluralApiKey: string) =>
      validateDefinition(model({ apiKey: 'news', pluralApiKey })).map(
        (found) => `${found.path} ${found.code}`,
      );
    expect(pathsAndCodes('newsItems')).toEqual([]);
    expect(pathsAndCodes('News')).toEqual(['/pluralApiKey PLURAL_API_KEY_SAME_AS_SINGULAR']);
    expect(pathsAndCodes('news-items')).toEqual(['/pluralApiKey API_KEY_INVALID']);
    expect(pathsAndCodes('__news')).toEqual(['/pluralApiKey API_KEY_RESERVED_PREFIX']);
    expect(pathsAndCodes('n'.repeat(65))).toEqual(['/pluralApiKey API_KEY_TOO_LONG']);
  });

  it('reserves the API IDs the admin uses as URL segments, for models and components', () => {
    const codes = (definition: Parameters<typeof validateDefinition>[0]) =>
      validateDefinition(definition).map((found) => `${found.path} ${found.code} ${found.message}`);
    expect(codes(model({ apiKey: 'new', pluralApiKey: 'newItems' }))).toEqual([
      '/apiKey API_KEY_RESERVED "new" is reserved by the admin',
    ]);
    expect(codes(model({ apiKey: 'Components', pluralApiKey: 'componentItems' }))).toEqual([
      '/apiKey API_KEY_RESERVED "Components" is reserved by the admin',
    ]);
    expect(codes(component({ apiKey: 'components' }))).toEqual([
      '/apiKey API_KEY_RESERVED "components" is reserved by the admin',
    ]);
    expect(codes(model({ apiKey: 'news' }))).toEqual([]);
  });

  it('reports an invalid API ID once, not again for the plural derived from it', () => {
    expect(validateDefinition(model({ apiKey: '1post' })).map((found) => found.path)).toEqual(['/apiKey']);
  });

  it('rejects field keys that collide case-insensitively and duplicate field IDs', () => {
    expect(codesFor({ apiKey: 'title' }, { apiKey: 'Title' })).toEqual([
      '/fields/1/apiKey API_KEY_COLLISION',
    ]);
    expect(codesFor({ apiKey: 'a', id: id(5) }, { apiKey: 'b', id: id(5) })).toEqual([
      '/fields/1/id DUPLICATE_ID',
    ]);
  });

  it('rejects inverted ranges for lengths, numbers, big integers, decimals and dates', () => {
    expect(codesFor({ apiKey: 'a', settings: settings({ minLength: 5, maxLength: 2 }) })).toEqual([
      '/fields/0/settings/minLength INVALID_RANGE',
    ]);
    expect(codesFor({ apiKey: 'a', type: 'number', settings: settings({ min: 5, max: 2 }) })).toEqual([
      '/fields/0/settings/min INVALID_RANGE',
    ]);
    expect(
      codesFor({
        apiKey: 'a',
        type: 'biginteger',
        settings: settings({ min: '90071992547409930', max: '9007199254740993' }),
      }),
    ).toEqual(['/fields/0/settings/min INVALID_RANGE']);
    expect(
      codesFor({ apiKey: 'a', type: 'decimal', settings: settings({ precision: 2, scale: 3 }) }),
    ).toEqual(['/fields/0/settings/scale INVALID_RANGE']);
    expect(
      codesFor({ apiKey: 'a', type: 'date', settings: settings({ min: '2026-02-01', max: '2026-01-01' }) }),
    ).toEqual(['/fields/0/settings/min INVALID_RANGE']);
  });

  it('rejects an invalid regular expression', () => {
    expect(codesFor({ apiKey: 'a', settings: settings({ pattern: '(' }) })).toEqual([
      '/fields/0/settings/pattern INVALID_PATTERN',
    ]);
  });

  it('rejects enum values that are not GraphQL names or are duplicated', () => {
    const values = [
      { value: 'ok', label: 'OK' },
      { value: 'true', label: 'True' },
      { value: 'a-b', label: 'A' },
      { value: 'ok', label: 'Again' },
    ];
    expect(codesFor({ apiKey: 'e', type: 'enum', settings: settings({ values }) })).toEqual([
      '/fields/0/settings/values/1/value INVALID_ENUM_VALUE',
      '/fields/0/settings/values/2/value INVALID_ENUM_VALUE',
      '/fields/0/settings/values/3/value DUPLICATE_ENUM_VALUE',
    ]);
  });

  it('checks the slug source field', () => {
    expect(codesFor({ apiKey: 's', type: 'slug', settings: settings({ sourceFieldId: id(77) }) })).toEqual([
      '/fields/0/settings/sourceFieldId UNKNOWN_FIELD_REFERENCE',
    ]);
    expect(
      codesFor(
        { apiKey: 'n', id: id(78), type: 'number' },
        { apiKey: 's', type: 'slug', settings: settings({ sourceFieldId: id(78) }) },
      ),
    ).toEqual(['/fields/1/settings/sourceFieldId INVALID_FIELD_REFERENCE']);
    expect(
      codesFor(
        { apiKey: 't', id: id(79) },
        { apiKey: 's', type: 'slug', settings: settings({ sourceFieldId: id(79) }) },
      ),
    ).toEqual([]);
  });

  it('rejects an unsupported rich-text format version', () => {
    expect(codesFor({ apiKey: 'r', type: 'richtext', settings: settings({ formatVersion: 2 }) })).toEqual([
      '/fields/0/settings/formatVersion INVALID_SETTINGS',
    ]);
  });

  it('requires reference settings to hold stable IDs', () => {
    expect(
      codesFor({
        apiKey: 'r',
        type: 'relation',
        settings: settings({ target: 'author', cardinality: 'one' }),
      }),
    ).toEqual(['/fields/0/settings/target INVALID_ID']);
    expect(codesFor({ apiKey: 'c', type: 'component', settings: settings({ component: 'hero' }) })).toEqual([
      '/fields/0/settings/component INVALID_ID',
    ]);
    expect(
      codesFor({ apiKey: 'z', type: 'dynamiczone', settings: settings({ components: ['hero'] }) }),
    ).toEqual(['/fields/0/settings/components/0 INVALID_ID']);
  });

  it('only allows unique, filterable and sortable where they make sense', () => {
    expect(codesFor({ apiKey: 'j', type: 'json', unique: true, filterable: true, sortable: true })).toEqual([
      '/fields/0/unique UNSUPPORTED_FLAG',
      '/fields/0/filterable UNSUPPORTED_FLAG',
      '/fields/0/sortable UNSUPPORTED_FLAG',
    ]);
    expect(codesFor({ apiKey: 'b', type: 'boolean', unique: true, filterable: true })).toEqual([
      '/fields/0/unique UNSUPPORTED_FLAG',
    ]);
    const values = [{ value: 'a', label: 'A' }];
    expect(
      codesFor({
        apiKey: 'e',
        type: 'enum',
        filterable: true,
        settings: settings({ values, multiple: true }),
        editor: { id: 'checkboxGroup' },
      }),
    ).toEqual(['/fields/0/filterable UNSUPPORTED_FLAG']);
  });

  it('rejects unique and index flags on component fields', () => {
    const issues = validateDefinition(
      component({ fields: [field({ apiKey: 'a', unique: true, sortable: true })] }),
    );
    expect(issues.map((found) => `${found.path} ${found.code}`)).toEqual([
      '/fields/0/unique UNSUPPORTED_FLAG',
      '/fields/0/sortable UNSUPPORTED_FLAG',
    ]);
  });

  it('rejects a required deprecated field', () => {
    expect(codesFor({ apiKey: 'a', required: true, deprecated: true })).toEqual([
      '/fields/0/required UNSUPPORTED_FLAG',
    ]);
  });

  it('checks default values against the data type', () => {
    expect(codesFor({ apiKey: 'a', type: 'integer', defaultValue: 1.5 })).toEqual([
      '/fields/0/defaultValue INVALID_DEFAULT_VALUE',
    ]);
    expect(codesFor({ apiKey: 'a', type: 'media', defaultValue: 'x' })).toEqual([
      '/fields/0/defaultValue INVALID_DEFAULT_VALUE',
    ]);
    expect(codesFor({ apiKey: 'a', type: 'string', defaultValue: '' })).toEqual([]);
  });

  it('validates the editor choice against the catalogue', () => {
    expect(codesFor({ apiKey: 'a', editor: { id: 'nope' } })).toEqual(['/fields/0/editor/id UNKNOWN_EDITOR']);
    expect(codesFor({ apiKey: 'a', editor: { id: 'toggle' } })).toEqual([
      '/fields/0/editor/id INCOMPATIBLE_EDITOR',
    ]);
    expect(
      codesFor({ apiKey: 'a', type: 'text', editor: { id: 'textarea', options: { rows: 100 } } }),
    ).toEqual(['/fields/0/editor/options/rows INVALID_EDITOR_OPTIONS']);
    expect(codesFor({ apiKey: 'a', editor: { id: 'acme.colorWheel', options: { anything: true } } })).toEqual(
      [],
    );
    expect(codesFor({ apiKey: 'f', type: 'boolean', editor: { id: 'segmented' } })).toEqual([]);
  });

  it('checks display references', () => {
    const definition = model({
      fields: [field({ apiKey: 'title', id: id(1) }), field({ apiKey: 'flag', id: id(2), type: 'boolean' })],
      display: {
        titleFieldId: id(2),
        listFieldIds: [id(3)],
        defaultSort: { fieldId: id(1), direction: 'asc' },
        groups: [
          { id: 'main', label: 'Main', fieldIds: [id(1), id(9)] },
          { id: 'main', label: 'Again', fieldIds: [id(1)] },
        ],
      },
    });
    expect(validateDefinition(definition).map((found) => `${found.path} ${found.code}`)).toEqual([
      '/display/titleFieldId INVALID_FIELD_REFERENCE',
      '/display/listFieldIds/0 UNKNOWN_FIELD_REFERENCE',
      '/display/defaultSort/fieldId INVALID_FIELD_REFERENCE',
      '/display/groups/0/fieldIds/1 UNKNOWN_FIELD_REFERENCE',
      '/display/groups/1/id DUPLICATE_GROUP',
      '/display/groups/1/fieldIds/0 INVALID_FIELD_REFERENCE',
    ]);
  });

  describe('document layout', () => {
    const layoutFields = [
      field({ id: id(1), apiKey: 'title' }),
      field({ id: id(2), apiKey: 'body', type: 'richtext' }),
      field({ id: id(3), apiKey: 'cover', type: 'media' }),
      field({ id: id(4), apiKey: 'gallery', type: 'media', settings: settings({ multiple: true }) }),
      field({ id: id(5), apiKey: 'seo', type: 'component', settings: settings({ component: id(900) }) }),
      field({
        id: id(6),
        apiKey: 'sections',
        type: 'component',
        settings: settings({ component: id(900), repeatable: true }),
      }),
      field({
        id: id(7),
        apiKey: 'files',
        type: 'media',
        settings: settings({ allowedKinds: ['document'] }),
      }),
      field({
        id: id(8),
        apiKey: 'zone',
        type: 'dynamiczone',
        settings: settings({ components: [id(900)] }),
      }),
    ];
    const layoutCodes = (display: ModelDefinition['display']) =>
      validateDefinition(model({ fields: layoutFields, display })).map(
        (found) => `${found.path} ${found.code}`,
      );

    it('accepts eligible canvas, cover and strip fields', () => {
      expect(
        layoutCodes({
          canvasFieldIds: [id(2), id(4), id(6), id(8)],
          coverFieldId: id(3),
          stripFieldIds: [id(1), id(5), id(7)],
        }),
      ).toEqual([]);
    });

    it('accepts any field but the title in the canvas: a single image, the SEO group, a document', () => {
      expect(layoutCodes({ canvasFieldIds: [id(3), id(5), id(7), id(2)] })).toEqual([]);
    });

    it('rejects unknown and repeated canvas fields, and the title', () => {
      expect(layoutCodes({ canvasFieldIds: [id(2), id(99), id(2), id(1)] })).toEqual([
        '/display/canvasFieldIds/1 UNKNOWN_FIELD_REFERENCE',
        '/display/canvasFieldIds/2 INVALID_FIELD_REFERENCE',
        '/display/canvasFieldIds/3 INVALID_FIELD_REFERENCE',
      ]);
    });

    it('rejects the configured title in the canvas, whatever its type, and allows the automatic one then', () => {
      const fields = [...layoutFields, field({ id: id(9), apiKey: 'handle', type: 'slug' })];
      const codes = (display: ModelDefinition['display']) =>
        validateDefinition(model({ fields, display })).map((found) => `${found.path} ${found.code}`);
      expect(codes({ titleFieldId: id(9), canvasFieldIds: [id(9)] })).toEqual([
        '/display/canvasFieldIds/0 INVALID_FIELD_REFERENCE',
      ]);
      expect(codes({ titleFieldId: id(9), canvasFieldIds: [id(1)] })).toEqual([]);
    });

    it('rejects a cover that is unknown, not a single image field, or in the canvas', () => {
      expect(layoutCodes({ coverFieldId: id(99) })).toEqual([
        '/display/coverFieldId UNKNOWN_FIELD_REFERENCE',
      ]);
      expect(layoutCodes({ coverFieldId: id(1) })).toEqual(['/display/coverFieldId INVALID_FIELD_REFERENCE']);
      expect(layoutCodes({ coverFieldId: id(7) })).toEqual(['/display/coverFieldId INVALID_FIELD_REFERENCE']);
      expect(layoutCodes({ coverFieldId: id(4), canvasFieldIds: [id(4)] })).toEqual([
        '/display/coverFieldId INVALID_FIELD_REFERENCE',
      ]);
    });

    it('rejects strip entries that are unknown, repeated, the cover or canvas blocks', () => {
      expect(
        layoutCodes({
          canvasFieldIds: [id(2)],
          coverFieldId: id(3),
          stripFieldIds: [id(1), id(1), id(2), id(3), id(99)],
        }),
      ).toEqual([
        '/display/stripFieldIds/1 INVALID_FIELD_REFERENCE',
        '/display/stripFieldIds/2 INVALID_FIELD_REFERENCE',
        '/display/stripFieldIds/3 INVALID_FIELD_REFERENCE',
        '/display/stripFieldIds/4 UNKNOWN_FIELD_REFERENCE',
      ]);
    });

    it('does not allow layout keys on components', () => {
      const result = parseDefinition({
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [{ apiKey: 'body', label: 'Body', type: 'richtext' }],
        display: { canvasFieldIds: ['x'] },
      });
      expect(result.ok).toBe(false);
    });
  });
});
