import { describe, expect, it } from 'vitest';
import { component, field, id, model } from '../testing/fixtures.js';
import type { FieldInput } from '../types/definitions.js';
import { generatedNames } from './naming.js';
import {
  findDependentModels,
  findReferencingDefinitions,
  MAX_COMPONENT_DEPTH,
  validateSchema,
} from './schema.js';

const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];
const codes = (issues: ReturnType<typeof validateSchema>) =>
  issues.map((found) => `${found.definitionId ?? ''} ${found.path} ${found.code}`);

describe('validateSchema: identity and names', () => {
  it('accepts unrelated definitions', () => {
    expect(
      validateSchema([
        model({ apiKey: 'page' }),
        model({ apiKey: 'article' }),
        component({ apiKey: 'hero' }),
      ]),
    ).toEqual([]);
  });

  it('rejects duplicate definition IDs', () => {
    const a = model({ id: id(1), apiKey: 'page' });
    const b = model({ id: id(1), apiKey: 'article' });
    expect(codes(validateSchema([a, b]))).toContain(`${id(1)} /id DUPLICATE_ID`);
  });

  it('rejects API keys that collide case-insensitively across models and components', () => {
    const page = model({ id: id(1), apiKey: 'page' });
    const pageComponent = component({ id: id(2), apiKey: 'Page' });
    expect(codes(validateSchema([page, pageComponent]))).toContain(`${id(2)} /apiKey API_KEY_COLLISION`);
  });

  it('rejects field IDs reused across definitions', () => {
    const a = model({ apiKey: 'a', fields: [field({ apiKey: 'x', id: id(50) })] });
    const b = model({ id: id(2), apiKey: 'b', fields: [field({ apiKey: 'y', id: id(50) })] });
    expect(codes(validateSchema([a, b]))).toContain(`${id(2)} /fields/0/id DUPLICATE_ID`);
  });

  it.each([
    'string',
    'query',
    'pageInfo',
    'dateTime',
    'stringFilter',
    'mediaVariant',
    'focalPoint',
    'mediaAsset',
    'int53',
    'entry',
  ])('rejects a model whose GraphQL type is reserved: %s', (apiKey) => {
    expect(codes(validateSchema([model({ id: id(3), apiKey })]))).toContain(
      `${id(3)} /apiKey API_KEY_RESERVED`,
    );
  });

  it.each(['_schemaVersion', '_changes', '_snapshot', '_Changes'])(
    'rejects a model whose query name is a fixed root field: %s',
    (apiKey) => {
      expect(codes(validateSchema([model({ id: id(3), apiKey })]))).toContain(
        `${id(3)} /apiKey API_KEY_RESERVED`,
      );
    },
  );

  it.each([
    'snapshotChange',
    'snapshotChangeKind',
    'snapshotChangeLocale',
    'snapshotChangePage',
    'snapshotInfo',
  ])('rejects a model named after a snapshot diff type: %s', (apiKey) => {
    expect(codes(validateSchema([model({ id: id(3), apiKey })]))).toContain(
      `${id(3)} /apiKey API_KEY_RESERVED`,
    );
  });

  it('still accepts a model called snapshot', () => {
    expect(codes(validateSchema([model({ id: id(3), apiKey: 'snapshot' })]))).toEqual([]);
  });

  it('rejects generated type name collisions (XFilter, XInput, XConnection, XLocalizations)', () => {
    for (const suffix of ['Filter', 'Input', 'Connection', 'Localizations']) {
      const page = model({ id: id(1), apiKey: 'page' });
      const clash = model({ id: id(2), apiKey: `page${suffix}` });
      expect(codes(validateSchema([page, clash]))).toContain(`${id(2)} /apiKey GENERATED_NAME_COLLISION`);
    }
  });

  it('rejects a component named like a model input type', () => {
    const page = model({ id: id(1), apiKey: 'page' });
    const input = component({ id: id(2), apiKey: 'pageInput' });
    expect(codes(validateSchema([page, input]))).toContain(`${id(2)} /apiKey GENERATED_NAME_COLLISION`);
  });

  it("rejects a model whose API ID is another collection's plural (list query and route)", () => {
    const post = model({ id: id(1), apiKey: 'post' });
    const posts = model({ id: id(2), apiKey: 'posts', pluralApiKey: 'allPosts' });
    expect(codes(validateSchema([post, posts]))).toEqual(
      expect.arrayContaining([
        `${id(2)} /apiKey API_KEY_COLLISION`,
        `${id(2)} /apiKey GENERATED_NAME_COLLISION`,
      ]),
    );
  });

  it('reports a colliding plural API ID at /pluralApiKey', () => {
    const post = model({ id: id(1), apiKey: 'post' });
    const article = model({ id: id(2), apiKey: 'article', pluralApiKey: 'Posts' });
    expect(codes(validateSchema([post, article]))).toEqual(
      expect.arrayContaining([
        `${id(2)} /pluralApiKey API_KEY_COLLISION`,
        `${id(2)} /pluralApiKey GENERATED_NAME_COLLISION`,
      ]),
    );
  });

  it('rejects a plural API ID equal to a component API ID', () => {
    const hero = component({ id: id(1), apiKey: 'heroes' });
    const page = model({ id: id(2), apiKey: 'hero' });
    expect(codes(validateSchema([hero, page]))).toContain(`${id(2)} /pluralApiKey API_KEY_COLLISION`);
  });

  it('rejects a plural API ID that is a fixed root query field', () => {
    const page = model({ id: id(3), apiKey: 'page', pluralApiKey: '_schemaVersion' });
    expect(codes(validateSchema([page]))).toContain(`${id(3)} /pluralApiKey API_KEY_RESERVED`);
  });

  it('gives singletons no list query, so their derived plural is free', () => {
    const settingsModel = model({ id: id(1), apiKey: 'setting', kind: 'singleton' });
    const settingsList = model({ id: id(2), apiKey: 'settings', kind: 'singleton' });
    expect(validateSchema([settingsModel, settingsList])).toEqual([]);
  });

  it('checks a stored collection without a plural against its derived one', () => {
    const { pluralApiKey: _dropped, ...stored } = model({ id: id(1), apiKey: 'post' });
    const posts = model({ id: id(2), apiKey: 'posts', pluralApiKey: 'allPosts' });
    expect(codes(validateSchema([stored, posts]))).toContain(`${id(2)} /apiKey API_KEY_COLLISION`);
  });

  it('rejects per-field generated names that collide with another model', () => {
    const page = model({
      id: id(1),
      apiKey: 'page',
      fields: [
        field({ apiKey: 'tone', type: 'enum', settings: settings({ values: [{ value: 'a', label: 'A' }] }) }),
      ],
    });
    const clash = model({ id: id(2), apiKey: 'pageToneEnum' });
    expect(codes(validateSchema([page, clash]))).toContain(`${id(2)} /apiKey GENERATED_NAME_COLLISION`);
  });

  it('lists the generated names J must use', () => {
    const hero = component({ id: id(9), apiKey: 'hero' });
    const names = generatedNames(
      model({
        apiKey: 'page',
        fields: [
          field({ apiKey: 'body', type: 'dynamiczone', settings: settings({ components: [hero.id] }) }),
        ],
      }),
    ).map((name) => `${name.namespace}:${name.name}`);
    expect(names).toEqual([
      'type:Page',
      'type:PageFilter',
      'type:PageInput',
      'type:PageConnection',
      'type:PageEdge',
      'type:PageLocalizations',
      'type:PageSort',
      'type:PageBodyZone',
      'type:PageBodyZoneInput',
      'query:page',
      'query:pages',
      'mutation:createPage',
      'mutation:updatePage',
      'mutation:deletePage',
      'mutation:publishPage',
      'mutation:unpublishPage',
    ]);
  });
});

describe('validateSchema: references', () => {
  const author = model({ id: id(10), apiKey: 'author' });
  const settingsModel = model({ id: id(11), kind: 'singleton', apiKey: 'siteSettings' });
  const hero = component({ id: id(12), apiKey: 'hero' });

  it('accepts valid relation, component and dynamic zone targets', () => {
    const page = model({
      id: id(13),
      apiKey: 'page',
      fields: [
        field({
          apiKey: 'author',
          type: 'relation',
          settings: settings({ target: author.id, cardinality: 'many' }),
        }),
        field({ apiKey: 'hero', type: 'component', settings: settings({ component: hero.id }) }),
        field({ apiKey: 'body', type: 'dynamiczone', settings: settings({ components: [hero.id] }) }),
      ],
    });
    expect(validateSchema([author, hero, page])).toEqual([]);
  });

  it('rejects unknown and wrong-kind targets', () => {
    const page = model({
      id: id(13),
      apiKey: 'page',
      fields: [
        field({ apiKey: 'a', type: 'relation', settings: settings({ target: id(99), cardinality: 'one' }) }),
        field({ apiKey: 'b', type: 'relation', settings: settings({ target: hero.id, cardinality: 'one' }) }),
        field({
          apiKey: 'c',
          type: 'relation',
          settings: settings({ target: settingsModel.id, cardinality: 'one' }),
        }),
        field({ apiKey: 'd', type: 'component', settings: settings({ component: author.id }) }),
        field({ apiKey: 'e', type: 'component', settings: settings({ component: id(98) }) }),
        field({ apiKey: 'f', type: 'dynamiczone', settings: settings({ components: [hero.id, hero.id] }) }),
      ],
    });
    expect(codes(validateSchema([author, settingsModel, hero, page]))).toEqual([
      `${id(13)} /fields/0/settings/target UNKNOWN_REFERENCE`,
      `${id(13)} /fields/1/settings/target INVALID_REFERENCE_TARGET`,
      `${id(13)} /fields/2/settings/target INVALID_REFERENCE_TARGET`,
      `${id(13)} /fields/3/settings/component INVALID_REFERENCE_TARGET`,
      `${id(13)} /fields/4/settings/component UNKNOWN_REFERENCE`,
      `${id(13)} /fields/5/settings/components/1 DUPLICATE_ID`,
    ]);
  });

  it('rejects component cycles, including through dynamic zones and self-reference', () => {
    const a = component({
      id: id(20),
      apiKey: 'a',
      fields: [field({ apiKey: 'b', type: 'component', settings: settings({ component: id(21) }) })],
    });
    const b = component({
      id: id(21),
      apiKey: 'b',
      fields: [field({ apiKey: 'a', type: 'dynamiczone', settings: settings({ components: [id(20)] }) })],
    });
    expect(codes(validateSchema([a, b]))).toContain(`${id(20)} /fields COMPONENT_CYCLE`);
    const self = component({
      id: id(22),
      apiKey: 'self',
      fields: [field({ apiKey: 's', type: 'component', settings: settings({ component: id(22) }) })],
    });
    expect(codes(validateSchema([self]))).toEqual([`${id(22)} /fields COMPONENT_CYCLE`]);
  });

  it(`rejects nesting deeper than ${MAX_COMPONENT_DEPTH} levels`, () => {
    const chain = (depth: number) => {
      const components = Array.from({ length: depth }, (_, index) =>
        component({
          id: id(100 + index),
          apiKey: `level${index}`,
          fields:
            index + 1 < depth
              ? [
                  field({
                    apiKey: 'next',
                    type: 'component',
                    settings: settings({ component: id(101 + index) }),
                  }),
                ]
              : [],
        }),
      );
      const root = model({
        id: id(99),
        apiKey: 'root',
        fields: [field({ apiKey: 'top', type: 'component', settings: settings({ component: id(100) }) })],
      });
      return [...components, root];
    };
    expect(validateSchema(chain(MAX_COMPONENT_DEPTH))).toEqual([]);
    expect(codes(validateSchema(chain(MAX_COMPONENT_DEPTH + 1)))).toEqual([
      `${id(99)} /fields COMPONENT_TOO_DEEP`,
    ]);
  });
});

describe('dependency lookups', () => {
  const inner = component({ id: id(30), apiKey: 'inner' });
  const outer = component({
    id: id(31),
    apiKey: 'outer',
    fields: [field({ apiKey: 'i', type: 'component', settings: settings({ component: inner.id }) })],
  });
  const page = model({
    id: id(32),
    apiKey: 'page',
    fields: [field({ apiKey: 'o', type: 'dynamiczone', settings: settings({ components: [outer.id] }) })],
  });
  const post = model({
    id: id(33),
    apiKey: 'post',
    fields: [
      field({ apiKey: 'p', type: 'relation', settings: settings({ target: page.id, cardinality: 'one' }) }),
    ],
  });
  const all = [inner, outer, page, post];

  it('finds models that embed a component transitively', () => {
    expect(findDependentModels(all, inner.id).map((definition) => definition.apiKey)).toEqual(['page']);
  });

  it('finds definitions that reference a definition', () => {
    expect(findReferencingDefinitions(all, page.id).map((definition) => definition.apiKey)).toEqual(['post']);
    expect(findReferencingDefinitions(all, inner.id).map((definition) => definition.apiKey)).toEqual([
      'outer',
    ]);
  });
});
