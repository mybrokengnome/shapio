import {
  compileLens,
  createDefinitionIndex,
  normalizeDefinition,
  plainTextToRichText,
  type DefinitionLens,
  type SchemaDefinition,
} from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../helpers/appError.js';
import { parseQueryTree } from '../compiler/querystring.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { rewriteQueryTree, type QueryRewriteContext } from './query.js';
import { readThroughLens } from './read.js';
import { writeThroughLens } from './write.js';

/** Deterministic UUIDs: id(1) = 00000000-0000-4000-8000-000000000001. */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

type FieldSpec = {
  id: string;
  apiKey: string;
  type?: string;
  settings?: Record<string, unknown>;
  localized?: boolean;
};
const toField = (spec: FieldSpec) => ({ label: spec.apiKey, type: 'string', ...spec });

const model = (fields: FieldSpec[], extra: Record<string, unknown> = {}): SchemaDefinition =>
  normalizeDefinition({
    id: id(1),
    kind: 'collection',
    apiKey: 'page',
    pluralApiKey: 'pages',
    label: 'Page',
    localized: true,
    ...extra,
    fields: fields.map(toField),
  } as Parameters<typeof normalizeDefinition>[0]);

const component = (componentId: string, apiKey: string, fields: FieldSpec[]): SchemaDefinition =>
  normalizeDefinition({
    id: componentId,
    kind: 'component',
    apiKey,
    label: apiKey,
    fields: fields.map(toField),
  } as Parameters<typeof normalizeDefinition>[0]);

const lensOf = (stored: SchemaDefinition[], client: SchemaDefinition[], definitionId = id(1)) =>
  compileLens(createDefinitionIndex(stored), createDefinitionIndex(client), definitionId) as DefinitionLens;

/** One field `value` (id 2) stored under `stored`, read as `client`. */
const readOne = (stored: FieldSpec, client: FieldSpec, value: unknown) =>
  readThroughLens(lensOf([model([stored])], [model([client])]), { [stored.id]: value })[client.id];

const F = id(2);
const enumOf = (values: string[], multiple: boolean) => ({
  values: values.map((value) => ({ value, label: value })),
  multiple,
});

describe('readThroughLens', () => {
  it('returns the stored data itself through an identity lens', () => {
    const definition = model([{ id: F, apiKey: 'title' }]);
    const data = { [F]: 'x' };
    expect(readThroughLens(lensOf([definition], [definition]), data)).toBe(data);
  });

  it('reads text → number → text values as stored, values written since included', () => {
    expect(readOne({ id: F, apiKey: 'price' }, { id: F, apiKey: 'price' }, 'abc')).toBe('abc');
  });

  it('converts text read as a number, and leaves out what is no number', () => {
    const stored = { id: F, apiKey: 'price' };
    const client = { id: F, apiKey: 'price', type: 'number' };
    expect(readOne(stored, client, '12')).toBe(12);
    expect(readOne(stored, client, ' 12 ')).toBe(12);
    expect(readOne(stored, client, 'abc')).toBeUndefined();
    expect(readOne(stored, client, '1,200')).toBeUndefined();
  });

  it('re-checks integer-ness and decimal format', () => {
    expect(
      readOne({ id: F, apiKey: 'n', type: 'number' }, { id: F, apiKey: 'n', type: 'integer' }, 12.5),
    ).toBe(undefined);
    expect(readOne({ id: F, apiKey: 'n', type: 'number' }, { id: F, apiKey: 'n', type: 'integer' }, 12)).toBe(
      12,
    );
    expect(
      readOne({ id: F, apiKey: 'n', type: 'number' }, { id: F, apiKey: 'n', type: 'decimal' }, 12.3),
    ).toBe('12.3');
    expect(
      readOne({ id: F, apiKey: 'n', type: 'number' }, { id: F, apiKey: 'n', type: 'decimal' }, 1e-7),
    ).toBeUndefined();
  });

  it('ignores length and range rules of the client: they are validation, not shape', () => {
    const client = { id: F, apiKey: 'title', settings: { maxLength: 2 } };
    expect(readOne({ id: F, apiKey: 'title', type: 'text' }, client, 'longer')).toBe('longer');
  });

  it('reads a field removed and re-added under the same API ID as null, ignoring leftover values', () => {
    const NEW = id(8);
    const lens = lensOf(
      [model([{ id: NEW, apiKey: 'price' }])],
      [model([{ id: F, apiKey: 'price', type: 'number' }])],
    );
    expect(readThroughLens(lens, { [F]: 5, [NEW]: 'x' })).toEqual({});
  });

  it('checks enum membership after list or single', () => {
    const stored = { id: F, apiKey: 'tags', type: 'enum', settings: enumOf(['a', 'b', 'c'], true) };
    const client = { id: F, apiKey: 'tags', type: 'enum', settings: enumOf(['a', 'b'], false) };
    expect(readOne(stored, client, ['a', 'c'])).toBe('a');
    expect(readOne(stored, client, ['c', 'a'])).toBeUndefined();
    const listClient = { ...stored, settings: enumOf(['a'], true) };
    expect(
      readOne({ id: F, apiKey: 'tags', type: 'enum', settings: enumOf(['a'], false) }, listClient, 'a'),
    ).toEqual(['a']);
  });

  it('converts between rich text and plain text', () => {
    const doc = plainTextToRichText('hi');
    expect(readOne({ id: F, apiKey: 'body' }, { id: F, apiKey: 'body', type: 'richtext' }, 'hi')).toEqual(
      doc,
    );
    expect(
      readOne({ id: F, apiKey: 'body', type: 'richtext' }, { id: F, apiKey: 'body', type: 'text' }, doc),
    ).toBe('hi');
  });

  it('reads a storage it cannot convert as null', () => {
    expect(readOne({ id: F, apiKey: 'x', type: 'json' }, { id: F, apiKey: 'x' }, 'text')).toBeUndefined();
  });

  it('reads a relation list as one, and media one as a list', () => {
    const target = id(30);
    const many = { id: F, apiKey: 'r', type: 'relation', settings: { target, cardinality: 'many' } };
    const one = { ...many, settings: { target, cardinality: 'one' } };
    expect(readOne(many, one, [id(40), id(41)])).toBe(id(40));
    expect(readOne(one, many, id(40))).toEqual([id(40)]);
  });

  describe('components', () => {
    const HERO = id(5);
    const QUOTE = id(6);
    const HEADING = id(7);
    const hero = (type = 'string') => component(HERO, 'hero', [{ id: HEADING, apiKey: 'heading', type }]);
    const quote = component(QUOTE, 'quote', [{ id: id(9), apiKey: 'text' }]);
    const holder = (componentId: string, repeatable = false) =>
      model([{ id: F, apiKey: 'hero', type: 'component', settings: { component: componentId, repeatable } }]);

    it('reads a swapped component as null and a swapped-back one as stored', () => {
      expect(
        readThroughLens(lensOf([holder(QUOTE), hero(), quote], [holder(HERO), hero(), quote]), {
          [F]: { [id(9)]: 'q' },
        }),
      ).toEqual({});
      const back = lensOf([holder(HERO), hero(), quote], [holder(HERO), hero(), quote]);
      expect(readThroughLens(back, { [F]: { [HEADING]: 'h' } })).toEqual({ [F]: { [HEADING]: 'h' } });
    });

    it('converts inside a component changed on its own', () => {
      const lens = lensOf([holder(HERO), hero('number')], [holder(HERO), hero()]);
      expect(readThroughLens(lens, { [F]: { [HEADING]: 12 } })).toEqual({ [F]: { [HEADING]: '12' } });
    });

    it('follows repeatable changes', () => {
      const lens = lensOf([holder(HERO, true), hero()], [holder(HERO, false), hero()]);
      expect(readThroughLens(lens, { [F]: [{ [HEADING]: 'a' }, { [HEADING]: 'b' }] })).toEqual({
        [F]: { [HEADING]: 'a' },
      });
    });

    it('keeps dynamic-zone items of components the client allows and still exist', () => {
      const zone = (components: string[]) =>
        model([{ id: F, apiKey: 'blocks', type: 'dynamiczone', settings: { components } }]);
      const lens = lensOf([zone([HERO, QUOTE]), hero('number'), quote], [zone([HERO]), hero(), quote]);
      const read = readThroughLens(lens, {
        [F]: [
          { [COMPONENT_KEY]: QUOTE, [id(9)]: 'q' },
          { [COMPONENT_KEY]: HERO, [HEADING]: 3 },
        ],
      });
      expect(read).toEqual({ [F]: [{ [COMPONENT_KEY]: HERO, [HEADING]: '3' }] });
    });
  });
});

describe('rewriteQueryTree', () => {
  const T = id(30);
  const AUTHOR = id(31);
  const NAME = id(32);
  const stored = [
    model([
      { id: F, apiKey: 'headline' },
      { id: id(3), apiKey: 'count', type: 'number' },
      { id: id(4), apiKey: 'price', type: 'string' },
      { id: AUTHOR, apiKey: 'writer', type: 'relation', settings: { target: T, cardinality: 'one' } },
    ]),
    model(
      [
        { id: NAME, apiKey: 'fullName' },
        { id: id(33), apiKey: 'buddy', type: 'relation', settings: { target: T, cardinality: 'one' } },
      ],
      { id: T, apiKey: 'person', pluralApiKey: 'people' },
    ),
  ];
  const client = [
    model([
      { id: F, apiKey: 'title' },
      { id: id(3), apiKey: 'count', type: 'integer' },
      { id: id(4), apiKey: 'price', type: 'number' },
      { id: id(5), apiKey: 'gone' },
      { id: AUTHOR, apiKey: 'author', type: 'relation', settings: { target: T, cardinality: 'one' } },
    ]),
    model(
      [
        { id: NAME, apiKey: 'name' },
        { id: id(33), apiKey: 'friend', type: 'relation', settings: { target: T, cardinality: 'one' } },
      ],
      { id: T, apiKey: 'person', pluralApiKey: 'people' },
    ),
  ];
  const lens = lensOf(stored, client);
  const context: QueryRewriteContext = {
    lensFor: (definitionId) => lensOf(stored, client, definitionId),
    kindApiKey: (apiKey) => (apiKey === 'page' ? 'article' : undefined),
  };
  const rewrite = (query: string) => rewriteQueryTree(lens, parseQueryTree(query), context);
  const codeOf = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error instanceof AppError ? error.code : String(error);
    }
    return 'none';
  };

  it('renames filters (nested too), sorts and system attributes by stable ID', () => {
    const { tree } = rewrite(
      'filters[title][$eq]=x&filters[$or][0][count][$gt]=1&filters[$not][id][$eq]=y&sort=title:desc,createdAt&locale=en',
    );
    expect(JSON.parse(JSON.stringify(tree))).toEqual({
      filters: { headline: { $eq: 'x' }, $or: { 0: { count: { $gt: '1' } } }, $not: { id: { $eq: 'y' } } },
      sort: ['headline:desc', 'createdAt'],
      locale: 'en',
    });
  });

  it('refuses filters and sorts on a field gone or stored differently, and names unknown to the client', () => {
    expect(codeOf(() => rewrite('filters[gone][$eq]=1'))).toBe('LENS_QUERY_UNSUPPORTED');
    expect(codeOf(() => rewrite('sort=price'))).toBe('LENS_QUERY_UNSUPPORTED');
    // Today's name of a field is not the client's.
    expect(codeOf(() => rewrite('filters[headline][$eq]=1'))).toBe('INVALID_QUERY');
  });

  it('keeps fields= of a gone field as a selection that reads null', () => {
    const { tree, selectedFieldIds } = rewrite('fields=title,gone');
    expect(tree.fields).toEqual(['headline']);
    expect(selectedFieldIds).toEqual([F, id(5)]);
    const onlyGone = rewrite('fields=gone');
    expect(onlyGone.tree.fields).toBeUndefined();
    expect(onlyGone.selectedFieldIds).toEqual([id(5)]);
  });

  it('renames populate paths through the target lens', () => {
    expect(rewrite('populate=author.friend,*').tree.populate).toEqual(['writer.buddy', '*']);
    expect(codeOf(() => rewrite('populate=author.name'))).toBe('INVALID_QUERY');
  });

  it('maps kinds and refuses one unknown today', () => {
    expect(rewrite('filters[__model][$in]=page').tree.filters).toEqual({ __model: { $in: 'article' } });
    expect(codeOf(() => rewrite('filters[__model]=essay'))).toBe('LENS_QUERY_UNSUPPORTED');
  });

  it('drops a populate path through a relation whose target moved', () => {
    const moved = lensOf(
      [
        model([
          {
            id: AUTHOR,
            apiKey: 'author',
            type: 'relation',
            settings: { target: id(50), cardinality: 'one' },
          },
        ]),
      ],
      [
        model([
          { id: AUTHOR, apiKey: 'author', type: 'relation', settings: { target: T, cardinality: 'one' } },
        ]),
      ],
    );
    expect(rewriteQueryTree(moved, parseQueryTree('populate=author,*'), context).tree.populate).toEqual([
      '*',
    ]);
  });
});

describe('writeThroughLens', () => {
  const HERO = id(5);
  const HEADING = id(7);
  const NEW = id(8);
  const client = [
    model([
      { id: F, apiKey: 'title' },
      { id: id(3), apiKey: 'count', type: 'integer' },
      { id: id(4), apiKey: 'summary', localized: true },
      { id: id(6), apiKey: 'hero', type: 'component', settings: { component: HERO } },
    ]),
    component(HERO, 'hero', [{ id: HEADING, apiKey: 'heading' }]),
  ];
  const stored = (heroFields: FieldSpec[] = [{ id: HEADING, apiKey: 'title' }]) => [
    model([
      { id: F, apiKey: 'headline' },
      { id: id(3), apiKey: 'count', type: 'number' },
      { id: id(4), apiKey: 'summary', localized: false },
      { id: id(6), apiKey: 'hero', type: 'component', settings: { component: HERO } },
    ]),
    component(HERO, 'hero', heroFields),
  ];

  it('translates renamed fields, inside components too', () => {
    const lens = lensOf(stored(), client);
    expect(writeThroughLens(lens, { title: 'x', hero: { heading: 'h' } }, null)).toEqual({
      input: { headline: 'x', hero: { title: 'h' } },
      issues: [],
    });
  });

  it('refuses converted and re-localized fields unless they are sent back as read', () => {
    const lens = lensOf(stored(), client);
    const read = { [id(3)]: 3, [id(4)]: 's' };
    const result = writeThroughLens(lens, { count: 4, summary: 's2' }, read);
    expect(result.issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['/count', 'NOT_ALLOWED'],
      ['/summary', 'NOT_ALLOWED'],
    ]);
    expect(writeThroughLens(lens, { count: 3, summary: 's', title: 't' }, read)).toEqual({
      input: { headline: 't' },
      issues: [],
    });
  });

  it('refuses a component that gained a field the client does not know', () => {
    const lens = lensOf(
      stored([
        { id: HEADING, apiKey: 'heading' },
        { id: NEW, apiKey: 'subheading' },
      ]),
      client,
    );
    expect(writeThroughLens(lens, { hero: { heading: 'h' } }, null).issues).toEqual([
      expect.objectContaining({ path: '/hero', code: 'NOT_ALLOWED' }),
    ]);
  });

  it('refuses names the client version does not have', () => {
    const lens = lensOf(stored(), client);
    expect(writeThroughLens(lens, { headline: 'x' }, null).issues).toEqual([
      expect.objectContaining({ path: '/headline', code: 'UNKNOWN_FIELD' }),
    ]);
  });

  it('translates dynamic-zone component API IDs', () => {
    const zone = (heroKey: string, headingKey: string) => [
      model([{ id: F, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [HERO] } }]),
      component(HERO, heroKey, [{ id: HEADING, apiKey: headingKey }]),
    ];
    const lens = lensOf(zone('banner', 'title'), zone('hero', 'heading'));
    expect(writeThroughLens(lens, { blocks: [{ [COMPONENT_KEY]: 'hero', heading: 'h' }] }, null)).toEqual({
      input: { blocks: [{ [COMPONENT_KEY]: 'banner', title: 'h' }] },
      issues: [],
    });
  });
});
