import {
  compileLens,
  createDefinitionIndex,
  normalizeDefinition,
  plainTextToRichText,
  type ComponentDefinition,
  type DefinitionLens,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../helpers/appError.js';
import { parseQueryTree } from '../compiler/querystring.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { keepUnreadableComponentFields } from '../write/keepUnreadable.js';
import { CARRY_MAX_ITEMS } from '../write/listPairing.js';
import { rewriteQueryTree, type QueryRewriteContext } from './query.js';
import { readThroughLens } from './read.js';
import { clientApiKey, issuesInClientNames, readableThroughLens, writeThroughLens } from './write.js';

/** Deterministic UUIDs: id(1) = 00000000-0000-4000-8000-000000000001. */

/** Stored data without item IDs (`__id`, at any depth): the tests compare content. */
const noIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(noIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([key, item]) => [key, noIds(item)]),
        )
      : value;

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

type FieldSpec = {
  id: string;
  apiKey: string;
  type?: string;
  settings?: Record<string, unknown>;
  localized?: boolean;
  public?: boolean;
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
    ).toBe('0.0000001');
    expect(
      readOne({ id: F, apiKey: 'n', type: 'number' }, { id: F, apiKey: 'n', type: 'biginteger' }, 1e21),
    ).toBe('1000000000000000000000');
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
    // A list read as one value: the first value that fits.
    expect(readOne(stored, client, ['c', 'a'])).toBe('a');
    expect(readOne(stored, client, ['c'])).toBeUndefined();
    // A list read as a list: the values that fit.
    expect(readOne(stored, { ...client, settings: enumOf(['a', 'b'], true) }, ['c', 'a'])).toEqual(['a']);
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
  const baseOf = (
    definitions: SchemaDefinition[],
    entry: { stored: Record<string, unknown>; read: Record<string, unknown> } | null = null,
  ) => {
    const index = createDefinitionIndex(definitions);
    return {
      stored: entry?.stored ?? null,
      reads: entry?.read ? [entry.read] : [],
      definitionOf: (definitionId: string) => index.resolve(definitionId) ?? index.get(definitionId),
    };
  };

  it('translates renamed fields, inside components too', () => {
    const lens = lensOf(stored(), client);
    expect(writeThroughLens(lens, { title: 'x', hero: { heading: 'h' } }, baseOf(stored()))).toMatchObject({
      input: { headline: 'x', hero: { title: 'h' } },
      issues: [],
    });
  });

  it('refuses converted and re-localized fields, saying how they changed, unless sent back as read', () => {
    const lens = lensOf(stored(), client);
    const entry = { stored: { [id(3)]: 3, [id(4)]: 's' }, read: { [id(3)]: 3, [id(4)]: 's' } };
    const result = writeThroughLens(lens, { count: 4, summary: 's2' }, baseOf(stored(), entry));
    expect(result.issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['/count', 'NOT_ALLOWED'],
      ['/summary', 'NOT_ALLOWED'],
    ]);
    expect(result.issues[0]?.message).toContain('changed type (integer → number)');
    expect(result.issues[1]?.message).toContain('became shared across locales');
    // Sent back as read: left out of the patch, so the stored value stays untouched.
    expect(
      writeThroughLens(lens, { count: 3, summary: 's', title: 't' }, baseOf(stored(), entry)),
    ).toMatchObject({
      input: { headline: 't' },
      issues: [],
    });
    // Nothing to compare with on create.
    expect(writeThroughLens(lens, { count: 3 }, baseOf(stored())).issues).toHaveLength(1);
  });

  it('leaves out what an instance holds that the client cannot write or does not know; storage carries it', () => {
    const today = stored([
      { id: HEADING, apiKey: 'heading' },
      { id: NEW, apiKey: 'subheading' },
      { id: id(9), apiKey: 'size', type: 'number' },
    ]);
    const clientWithSize = [
      client[0] as SchemaDefinition,
      component(HERO, 'hero', [
        { id: HEADING, apiKey: 'heading' },
        { id: id(9), apiKey: 'size', type: 'integer' },
      ]),
    ];
    const lens = lensOf(today, clientWithSize);
    const entry = {
      stored: { [id(6)]: { [HEADING]: 'old', [NEW]: 'kept', [id(9)]: 2.5 } },
      read: { [id(6)]: { [HEADING]: 'old' } },
    };
    const base = baseOf(today, entry);
    const written = writeThroughLens(lens, { hero: { heading: 'h' } }, base);
    expect(written).toMatchObject({
      input: { hero: { heading: 'h' } },
      issues: [],
    });
    const index = createDefinitionIndex(today);
    const fields = (index.resolve(id(1)) as { fields: FieldDefinition[] }).fields;
    const componentOf = (componentId: string) => index.get(componentId) as ComponentDefinition | undefined;
    expect(
      noIds(
        keepUnreadableComponentFields(
          { [id(6)]: { [HEADING]: 'h' } },
          entry.stored,
          fields,
          componentOf,
          () => true,
          { lens, pairings: written.pairings },
        ),
      ),
    ).toEqual({ [id(6)]: { [HEADING]: 'h', [NEW]: 'kept', [id(9)]: 2.5 } });
    expect(writeThroughLens(lens, { hero: { heading: 'h', size: 3 } }, base).issues).toEqual([
      expect.objectContaining({ path: '/hero/size', code: 'NOT_ALLOWED' }),
    ]);
  });

  it('translates dynamic-zone component API IDs; storage matches items by what the client sees', () => {
    const zone = (heroKey: string, fields: FieldSpec[]) => [
      model([{ id: F, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [HERO] } }]),
      component(HERO, heroKey, fields),
    ];
    const today = zone('banner', [
      { id: HEADING, apiKey: 'title' },
      { id: NEW, apiKey: 'extra' },
    ]);
    const lens = lensOf(today, zone('hero', [{ id: HEADING, apiKey: 'heading' }]));
    const stored = { [F]: [{ [COMPONENT_KEY]: HERO, [HEADING]: 'a', [NEW]: 'x' }] };
    const written = writeThroughLens(
      lens,
      {
        blocks: [
          { [COMPONENT_KEY]: 'hero', heading: 'new' },
          { [COMPONENT_KEY]: 'hero', heading: 'a' },
        ],
      },
      baseOf(today, { stored, read: { [F]: [{ [COMPONENT_KEY]: HERO, [HEADING]: 'a' }] } }),
    );
    expect(written).toMatchObject({
      input: {
        blocks: [
          { [COMPONENT_KEY]: 'banner', title: 'new' },
          { [COMPONENT_KEY]: 'banner', title: 'a' },
        ],
      },
      issues: [],
    });
    const index = createDefinitionIndex(today);
    const fields = (index.resolve(id(1)) as { fields: FieldDefinition[] }).fields;
    const componentOf = (componentId: string) => index.get(componentId) as ComponentDefinition | undefined;
    // The untouched item moved behind an inserted one keeps what the client does not know; the new one has none.
    expect(
      noIds(
        keepUnreadableComponentFields(
          {
            [F]: [
              { [COMPONENT_KEY]: HERO, [HEADING]: 'new' },
              { [COMPONENT_KEY]: HERO, [HEADING]: 'a' },
            ],
          },
          stored,
          fields,
          componentOf,
          () => true,
          { lens, pairings: written.pairings },
        ),
      ),
    ).toEqual({
      [F]: [
        { [COMPONENT_KEY]: HERO, [HEADING]: 'new' },
        { [COMPONENT_KEY]: HERO, [HEADING]: 'a', [NEW]: 'x' },
      ],
    });
  });

  it('refuses names the client version does not have', () => {
    const lens = lensOf(stored(), client);
    expect(writeThroughLens(lens, { headline: 'x' }, baseOf(stored())).issues).toEqual([
      expect.objectContaining({ path: '/headline', code: 'UNKNOWN_FIELD' }),
    ]);
  });

  it("maps today's validation pointers to the client's names and marks fields added since", () => {
    const today = [
      model([
        { id: F, apiKey: 'headline' },
        { id: id(6), apiKey: 'hero', type: 'component', settings: { component: HERO, repeatable: true } },
        { id: NEW, apiKey: 'subtitle' },
      ]),
      component(HERO, 'hero', [{ id: HEADING, apiKey: 'title' }]),
    ];
    const old = [
      model([
        { id: F, apiKey: 'title' },
        { id: id(6), apiKey: 'hero', type: 'component', settings: { component: HERO, repeatable: true } },
      ]),
      component(HERO, 'hero', [{ id: HEADING, apiKey: 'heading' }]),
    ];
    const lens = lensOf(today, old);
    expect(
      issuesInClientNames(
        lens,
        [
          { path: '/headline', code: 'TOO_LONG', message: 'is too long' },
          { path: '/hero/1/title', code: 'REQUIRED', message: 'is required' },
          { path: '/subtitle', code: 'REQUIRED', message: 'is required' },
        ],
        baseOf(today),
      ),
    ).toMatchObject([
      { path: '/title', code: 'TOO_LONG', message: 'is too long' },
      { path: '/hero/1/heading', code: 'REQUIRED', message: 'is required' },
      { path: '/subtitle', code: 'REQUIRED' },
    ]);
    const [added] = issuesInClientNames(
      lens,
      [{ path: '/subtitle', code: 'REQUIRED', message: 'is required' }],
      baseOf(today),
    );
    expect(added?.message).toContain('added after');
    expect(clientApiKey(lens, 'headline')).toBe('title');
  });
});

describe('readableThroughLens', () => {
  it('leaves out what the caller may not read, inside components too', () => {
    const HERO = id(5);
    const definitions = [
      model([
        { id: F, apiKey: 'title' },
        { id: id(3), apiKey: 'secret' },
        { id: id(6), apiKey: 'hero', type: 'component', settings: { component: HERO } },
      ]),
      component(HERO, 'hero', [
        { id: id(7), apiKey: 'open' },
        { id: id(8), apiKey: 'hidden' },
      ]),
    ];
    const lens = lensOf(definitions, definitions);
    expect(
      readableThroughLens(
        lens,
        { [F]: 't', [id(3)]: 's', [id(6)]: { [id(7)]: 'o', [id(8)]: 'h' } },
        (fieldId) => fieldId !== id(3),
        (fieldId) => fieldId !== id(8),
      ),
    ).toEqual({ [F]: 't', [id(6)]: { [id(7)]: 'o' } });
  });
});

describe('lens review findings', () => {
  const HERO = id(5);
  const QUOTE = id(6);
  const LINK = id(7);
  const OLD_TARGET = id(30);
  const NEW_TARGET = id(31);

  it('reads a relation inside a component whose target moved as absent, at any depth', () => {
    const card = (target: string) =>
      component(HERO, 'card', [
        { id: LINK, apiKey: 'link', type: 'relation', settings: { target, cardinality: 'one' } },
      ]);
    const holder = model([{ id: F, apiKey: 'card', type: 'component', settings: { component: HERO } }]);
    const lens = lensOf([holder, card(NEW_TARGET)], [holder, card(OLD_TARGET)]);
    expect(readThroughLens(lens, { [F]: { [LINK]: id(40) } })).toEqual({ [F]: {} });
  });

  it("never reads a zone item of a component today's zone no longer allows", () => {
    const hero = component(HERO, 'hero', [{ id: id(8), apiKey: 'title' }]);
    const quote = component(QUOTE, 'quote', [{ id: id(9), apiKey: 'text', public: false }]);
    const zone = (components: string[]) =>
      model([{ id: F, apiKey: 'blocks', type: 'dynamiczone', settings: { components } }]);
    const lens = lensOf([zone([HERO]), hero, quote], [zone([HERO, QUOTE]), hero, quote]);
    expect(
      readThroughLens(lens, {
        [F]: [
          { [COMPONENT_KEY]: QUOTE, [id(9)]: 'private' },
          { [COMPONENT_KEY]: HERO, [id(8)]: 'shown' },
        ],
      }),
    ).toEqual({ [F]: [{ [COMPONENT_KEY]: HERO, [id(8)]: 'shown' }] });
  });

  it('takes a media or relation value echoed from a delivery read as its IDs', () => {
    const today = [
      model([
        { id: F, apiKey: 'cover', type: 'media', settings: { multiple: true } },
        {
          id: id(3),
          apiKey: 'related',
          type: 'relation',
          settings: { target: OLD_TARGET, cardinality: 'many' },
        },
      ]),
    ];
    const old = [
      model([
        { id: F, apiKey: 'cover', type: 'media', settings: { multiple: false } },
        {
          id: id(3),
          apiKey: 'related',
          type: 'relation',
          settings: { target: OLD_TARGET, cardinality: 'one' },
        },
      ]),
    ];
    const lens = lensOf(today, old);
    const index = createDefinitionIndex(today);
    const base = {
      stored: { [F]: [id(50)], [id(3)]: [id(60), id(61)] },
      reads: [{ [F]: id(50), [id(3)]: id(60) }],
      definitionOf: (definitionId: string) => index.resolve(definitionId) ?? index.get(definitionId),
    };
    expect(
      writeThroughLens(
        lens,
        { cover: { id: id(50), url: 'https://cdn.example/a.png' }, related: { id: id(60), title: 'x' } },
        base,
      ),
    ).toMatchObject({ input: {}, issues: [] });
    // A value matching neither head is refused.
    expect(writeThroughLens(lens, { cover: { id: id(51) } }, base).issues).toHaveLength(1);
  });
});

describe('lens writes of lists (third review)', () => {
  const ITEM = id(5);
  const LIST = id(6);
  const LABEL = id(7);
  const SIZE = id(8);
  const definitions = (sizeType: string) => [
    model([
      { id: LIST, apiKey: 'items', type: 'component', settings: { component: ITEM, repeatable: true } },
    ]),
    component(ITEM, 'item', [
      { id: LABEL, apiKey: 'label' },
      { id: SIZE, apiKey: 'size', type: sizeType },
    ]),
  ];
  const today = definitions('number');
  const lens = lensOf(today, definitions('integer'));
  const index = createDefinitionIndex(today);
  const stored = {
    [LIST]: [
      { [LABEL]: 'A', [SIZE]: 1 },
      { [LABEL]: 'B', [SIZE]: 2 },
    ],
  };
  const base = {
    stored,
    reads: [stored],
    definitionOf: (definitionId: string) => index.resolve(definitionId) ?? index.get(definitionId),
  };

  it('compares each sent item with the stored item it continues, not the one at its position', () => {
    // `size` changed type since the version (not writable through it): sent back as read it is accepted, for
    // the item the client kept after deleting the first one, and for a reordered list.
    expect(writeThroughLens(lens, { items: [{ label: 'B', size: 2 }] }, base).issues).toEqual([]);
    expect(
      writeThroughLens(
        lens,
        {
          items: [
            { label: 'B', size: 2 },
            { label: 'A', size: 1 },
          ],
        },
        base,
      ).issues,
    ).toEqual([]);
    // Edited in place, each sending the value of the other: without IDs the items cannot be matched.
    const swapped = writeThroughLens(
      lens,
      {
        items: [
          { label: 'A', size: 2 },
          { label: 'B', size: 1 },
        ],
      },
      base,
    );
    expect(swapped.issues).toEqual([]);
    expect(swapped.itemIssues.map((issue) => [issue.path, issue.code])).toEqual([
      ['/items', 'AMBIGUOUS_ITEMS'],
    ]);
  });

  it('refuses a list longer than the write path considers before matching', () => {
    const many = Array.from({ length: CARRY_MAX_ITEMS + 1 }, () => ({ label: 'x' }));
    expect(() => writeThroughLens(lens, { items: many }, base)).toThrow(
      expect.objectContaining({ code: 'CONTENT_INVALID' }),
    );
  });

  it("gives a field the caller may not write today today's answer, never the lens's reason", () => {
    const page = (countType: string, extra: FieldSpec[] = []) => [
      model([{ id: F, apiKey: 'title' }, { id: id(3), apiKey: 'count', type: countType }, ...extra]),
    ];
    const write = lensOf(page('string'), page('integer', [{ id: id(9), apiKey: 'gone' }]));
    const todayIndex = createDefinitionIndex(page('string'));
    const result = writeThroughLens(
      write,
      { count: 1, gone: 'x', title: 't' },
      {
        stored: null,
        reads: [],
        definitionOf: (definitionId: string) =>
          todayIndex.resolve(definitionId) ?? todayIndex.get(definitionId),
        writable: (fieldId) => fieldId === F,
        writesEverything: false,
      },
    );
    // A field that exists today is passed on untranslated, for today's validator and write mask to answer as
    // without a version; one removed since is a field this version does not have (never today's `gone`).
    expect(result).toMatchObject({
      input: { title: 't', count: 1 },
      issues: [{ path: '/gone', code: 'UNKNOWN_FIELD', message: 'is not a field of this schema version' }],
    });
  });
});

describe('one pairing per written list (fourth review)', () => {
  // `card {label, size}`: `size` was an integer at the client's version and is text today, so the client reads
  // it (as a number) but cannot write it.
  const CARD = id(5);
  const CARDS = id(6);
  const LABEL = id(7);
  const SIZE = id(8);
  const BOX = id(9);
  const BOXES = id(10);
  const NAME = id(11);
  const ZONE = id(12);
  const definitions = (sizeType: string) => [
    model([
      { id: CARDS, apiKey: 'cards', type: 'component', settings: { component: CARD, repeatable: true } },
      { id: BOXES, apiKey: 'boxes', type: 'component', settings: { component: BOX, repeatable: true } },
      { id: ZONE, apiKey: 'blocks', type: 'dynamiczone', settings: { components: [CARD] } },
    ]),
    component(CARD, 'card', [
      { id: LABEL, apiKey: 'label' },
      { id: SIZE, apiKey: 'size', type: sizeType },
    ]),
    component(BOX, 'box', [
      { id: NAME, apiKey: 'name' },
      { id: id(13), apiKey: 'cards', type: 'component', settings: { component: CARD, repeatable: true } },
    ]),
  ];
  const today = definitions('string');
  const lens = lensOf(today, definitions('integer'));
  const index = createDefinitionIndex(today);
  const fields = (index.resolve(id(1)) as { fields: FieldDefinition[] }).fields;
  const componentOf = (componentId: string) => index.get(componentId) as ComponentDefinition | undefined;
  const twoAs = [
    { [LABEL]: 'A', [SIZE]: '1' },
    { [LABEL]: 'A', [SIZE]: '2' },
  ];

  /** The lens's write of `body` over `stored`, then the carry-over along its pairing: what would be stored. */
  const written = (body: Record<string, unknown>, stored: Record<string, unknown>, seesStored = true) => {
    const result = writeThroughLens(lens, body, {
      stored,
      reads: seesStored ? [readThroughLens(lens, stored)] : [],
      seesStored,
      definitionOf: (definitionId: string) => index.resolve(definitionId) ?? index.get(definitionId),
    });
    const issues = [...result.issues, ...result.itemIssues];
    if (issues.length > 0) {
      return issues.map((issue) => [issue.path, issue.code, issue.message]);
    }
    // Today's API IDs → field IDs, as `fromInput` maps them (the shapes here are flat enough to do by hand).
    const patch = JSON.parse(
      JSON.stringify(result.input)
        .replaceAll('"cards"', `"${CARDS}"`)
        .replaceAll('"boxes"', `"${BOXES}"`)
        .replaceAll('"blocks"', `"${ZONE}"`)
        .replaceAll('"label"', `"${LABEL}"`)
        .replaceAll('"size"', `"${SIZE}"`)
        .replaceAll('"name"', `"${NAME}"`)
        .replaceAll('"card"', `"${CARD}"`)
        .replaceAll('"id"', '"__id"'),
    ) as Record<string, unknown>;
    // Nested `cards` inside a box is field id(13), not the top-level CARDS.
    const boxes = patch[BOXES];
    if (Array.isArray(boxes)) {
      for (const box of boxes as Array<Record<string, unknown>>) {
        if (CARDS in box) {
          box[id(13)] = box[CARDS];
          delete box[CARDS];
        }
      }
    }
    return noIds(
      keepUnreadableComponentFields(patch, stored, fields, componentOf, () => true, {
        input: result.input,
        lens,
        pairings: result.pairings,
      }),
    );
  };

  it('keeps the value of the item the client kept, not of the first equal-looking one', () => {
    // The client read [{A,1},{A,2}], deleted the first, and sent the second back.
    expect(written({ cards: [{ label: 'A', size: 2 }] }, { [CARDS]: twoAs })).toEqual({
      [CARDS]: [{ [LABEL]: 'A', [SIZE]: '2' }],
    });
  });

  it('applies a swap of two items that differ only in a field the client cannot write', () => {
    expect(
      written(
        {
          cards: [
            { label: 'A', size: 2 },
            { label: 'A', size: 1 },
          ],
        },
        { [CARDS]: twoAs },
      ),
    ).toEqual({
      [CARDS]: [
        { [LABEL]: 'A', [SIZE]: '2' },
        { [LABEL]: 'A', [SIZE]: '1' },
      ],
    });
  });

  it('pairs a nested list under the item its parent continues, which needs IDs when the nested list changes', () => {
    const stored = {
      [BOXES]: [
        { [NAME]: 'x', __id: 'bx', [id(13)]: [{ [LABEL]: 'B', [SIZE]: '9', __id: 'c0' }] },
        {
          [NAME]: 'y',
          __id: 'by',
          [id(13)]: twoAs.map((item, index) => ({ ...item, __id: `c${index + 1}` })),
        },
      ],
    };
    // Without IDs: a change inside a box changes what the caller sees of the box, so the boxes cannot be told apart.
    expect(
      written(
        {
          boxes: [
            { name: 'x', cards: [{ label: 'B', size: 9 }] },
            { name: 'y', cards: [{ label: 'A', size: 2 }] },
          ],
        },
        stored,
      ),
    ).toEqual([['/boxes', 'AMBIGUOUS_ITEMS', expect.stringContaining('send back the id of each item')]]);
    // With IDs: the first box untouched; inside the second, the first card deleted.
    expect(
      written(
        {
          boxes: [
            { id: 'bx', name: 'x', cards: [{ id: 'c0', label: 'B', size: 9 }] },
            { id: 'by', name: 'y', cards: [{ id: 'c2', label: 'A', size: 2 }] },
          ],
        },
        stored,
      ),
    ).toEqual({
      [BOXES]: [
        { [NAME]: 'x', [id(13)]: [{ [LABEL]: 'B', [SIZE]: '9' }] },
        { [NAME]: 'y', [id(13)]: [{ [LABEL]: 'A', [SIZE]: '2' }] },
      ],
    });
  });

  it('pairs dynamic-zone items the same way', () => {
    const stored = { [ZONE]: twoAs.map((item) => ({ [COMPONENT_KEY]: CARD, ...item })) };
    expect(written({ blocks: [{ [COMPONENT_KEY]: 'card', label: 'A', size: 2 }] }, stored)).toEqual({
      [ZONE]: [{ [COMPONENT_KEY]: CARD, [LABEL]: 'A', [SIZE]: '2' }],
    });
  });

  it('an edit that could continue either of two items is refused; with IDs it is certain', () => {
    // Deleting one item and editing the other: which one was edited cannot be told from the body, and the items
    // hold a value the client cannot write, so the write is refused whole.
    // The ambiguity answers for the list: a field inside an item judged against no stored item says nothing true.
    expect(written({ cards: [{ label: 'A', size: 3 }] }, { [CARDS]: twoAs })).toEqual([
      ['/cards', 'AMBIGUOUS_ITEMS', expect.stringContaining('send back the id of each item')],
    ]);
    // With the IDs it read, the item is known: a value it does not hold is refused, the one it holds kept.
    const withIds = { [CARDS]: twoAs.map((item, index) => ({ ...item, __id: `i${index}` })) };
    expect(written({ cards: [{ id: 'i1', label: 'A', size: 3 }] }, withIds)).toEqual([
      ['/cards/0/size', 'NOT_ALLOWED', expect.stringContaining('changed type')],
    ]);
    expect(written({ cards: [{ id: 'i1', label: 'B', size: 2 }] }, withIds)).toEqual({
      [CARDS]: [{ [LABEL]: 'B', [SIZE]: '2' }],
    });
  });

  it('X: an ambiguous list reports its ambiguity, not a refusal of a field inside its items', () => {
    const stored = {
      [CARDS]: [{ [LABEL]: 'p', [SIZE]: '0' }, { [LABEL]: 'p' }],
    };
    expect(written({ cards: [{ label: 'p', size: 0 }, { label: 'n' }, { label: 'n' }] }, stored)).toEqual([
      ['/cards', 'AMBIGUOUS_ITEMS', expect.stringContaining('send back the id of each item')],
    ]);
  });

  it('X2: a value sent back on an item that matches no stored item is the list being ambiguous', () => {
    const stored = {
      [CARDS]: [
        { [LABEL]: 'p', __id: 'a' },
        { [LABEL]: 'q', [SIZE]: '1', __id: 'b' },
        { [LABEL]: 'q', __id: 'c' },
      ],
    };
    // `p` was sent at another place, so the second item is new: the size it sends back cannot be matched.
    expect(written({ cards: [{ label: 'e' }, { label: 'p', size: 1 }, { label: 'p' }] }, stored)).toEqual([
      ['/cards', 'AMBIGUOUS_ITEMS', expect.stringContaining('send back the id of each item')],
    ]);
    // With IDs: the item it names keeps its value; a new one sending a read-only value is refused for it.
    expect(
      written(
        {
          cards: [
            { id: null, label: 'e' },
            { id: 'b', label: 'p', size: 1 },
            { id: 'a', label: 'p' },
          ],
        },
        stored,
      ),
    ).toEqual({
      [CARDS]: [{ [LABEL]: 'e' }, { [LABEL]: 'p', [SIZE]: '1' }, { [LABEL]: 'p' }],
    });
    expect(written({ cards: [{ id: null, label: 'e', size: 1 }] }, stored)).toEqual([
      ['/cards/0/size', 'NOT_ALLOWED', expect.stringContaining('changed type')],
    ]);
  });

  it('AB: two items swapped and edited, each sending back what it read, is ambiguous without IDs', () => {
    const stored = {
      [CARDS]: [
        { [LABEL]: 'p', [SIZE]: '100', __id: 'a' },
        { [LABEL]: 'q', [SIZE]: '101', __id: 'b' },
      ],
    };
    // Read as an edit in place, each item would send back the other's value: the server cannot match them.
    expect(
      written(
        {
          cards: [
            { label: 'q2', size: 101 },
            { label: 'p2', size: 100 },
          ],
        },
        stored,
      ),
    ).toEqual([['/cards', 'AMBIGUOUS_ITEMS', expect.stringContaining('send back the id of each item')]]);
    // With IDs it is certain, and each value stays with its item.
    expect(
      written(
        {
          cards: [
            { id: 'b', label: 'q2', size: 101 },
            { id: 'a', label: 'p2', size: 100 },
          ],
        },
        stored,
      ),
    ).toEqual({
      [CARDS]: [
        { [LABEL]: 'q2', [SIZE]: '101' },
        { [LABEL]: 'p2', [SIZE]: '100' },
      ],
    });
    // A known ID with a changed value it cannot write stays that refusal.
    expect(
      written(
        {
          cards: [
            { id: 'b', label: 'q2', size: 7 },
            { id: 'a', label: 'p2', size: 100 },
          ],
        },
        stored,
      ),
    ).toEqual([['/cards/0/size', 'NOT_ALLOWED', expect.stringContaining('changed type')]]);
  });

  it('refuses an unknown or repeated ID, and takes a null ID as a new item', () => {
    const withIds = { [CARDS]: twoAs.map((item, index) => ({ ...item, __id: `i${index}` })) };
    expect(written({ cards: [{ id: 'nope', label: 'A' }] }, withIds)).toEqual([
      ['/cards/0/id', 'UNKNOWN_ITEM_ID', expect.stringContaining('is not the ID of an item this list holds')],
    ]);
    expect(
      written(
        {
          cards: [
            { id: 'i0', label: 'A' },
            { id: 'i0', label: 'A' },
          ],
        },
        withIds,
      ),
    ).toEqual([
      ['/cards/0/id', 'DUPLICATE_ITEM_ID', expect.stringContaining('more than one item')],
      ['/cards/1/id', 'DUPLICATE_ITEM_ID', expect.stringContaining('more than one item')],
    ]);
    // `id: null` names a new item: nothing is carried into it, so its value cannot have been read.
    expect(
      written(
        {
          cards: [
            { id: null, label: 'A', size: 1 },
            { id: 'i1', label: 'A', size: 2 },
          ],
        },
        withIds,
      ),
    ).toEqual([['/cards/0/size', 'NOT_ALLOWED', expect.stringContaining('changed type')]]);
  });

  it('for a caller that may not have read the draft: without IDs refused, with IDs certain', () => {
    const stored = {
      [CARDS]: [
        { [LABEL]: 'A', [SIZE]: '1', __id: 'a' },
        { [LABEL]: 'B', [SIZE]: '2', __id: 'b' },
      ],
    };
    // Without IDs it cannot say which items it replaces, and they hold a value it cannot write: refused.
    expect(written({ cards: [{ label: 'B' }, { label: 'A' }] }, stored, false)).toEqual([
      ['/cards', 'AMBIGUOUS_ITEMS', expect.stringContaining('replaces items this caller cannot read')],
    ]);
    // With the IDs it read, reordered, the field it cannot write left out: each item keeps its own value.
    expect(
      written(
        {
          cards: [
            { id: 'b', label: 'B' },
            { id: 'a', label: 'A' },
          ],
        },
        stored,
        false,
      ),
    ).toEqual({
      [CARDS]: [
        { [LABEL]: 'B', [SIZE]: '2' },
        { [LABEL]: 'A', [SIZE]: '1' },
      ],
    });
    // Sent with the value the draft holds, or any other: refused alike (no guess of the draft is tested).
    for (const size of [1, 7]) {
      expect(
        written(
          {
            cards: [
              { id: 'a', label: 'A', size },
              { id: 'b', label: 'B' },
            ],
          },
          stored,
          false,
        ),
      ).toEqual([['/cards/0/size', 'NOT_ALLOWED', expect.stringContaining('unpublished changes')]]);
    }
  });
});

describe('fields removed since the client version (fourth review)', () => {
  const GONE = id(3);
  const REUSED = id(4);
  const then = (isPublic: boolean) => [
    model([
      { id: F, apiKey: 'title' },
      { id: GONE, apiKey: 'gone', public: isPublic },
    ]),
  ];
  const now = [
    model([
      { id: F, apiKey: 'title' },
      { id: REUSED, apiKey: 'gone' },
    ]),
  ];
  const index = createDefinitionIndex(now);
  const base = (grant: { writesEverything: boolean }) => ({
    stored: null,
    reads: [],
    definitionOf: (definitionId: string) => index.resolve(definitionId) ?? index.get(definitionId),
    writable: () => true,
    ...grant,
  });

  it('never lands in a field added since under the same API ID', () => {
    const result = writeThroughLens(
      lensOf(now, then(true)),
      { gone: 'x' },
      base({ writesEverything: false }),
    );
    expect(result.input).toEqual({});
    expect(result.issues).toEqual([
      { path: '/gone', code: 'UNKNOWN_FIELD', message: 'is not a field of this schema version' },
    ]);
  });

  it('is named as removed only for a grant naming no fields, and only if it was public at the version', () => {
    const named = writeThroughLens(lensOf(now, then(true)), { gone: 'x' }, base({ writesEverything: true }));
    expect(named.input).toEqual({});
    expect(named.issues.map((issue) => [issue.path, issue.message.startsWith('was removed')])).toEqual([
      ['/gone', true],
    ]);
    const privateThen = writeThroughLens(
      lensOf(now, then(false)),
      { gone: 'x' },
      base({ writesEverything: true }),
    );
    expect(privateThen.issues).toEqual([
      { path: '/gone', code: 'UNKNOWN_FIELD', message: 'is not a field of this schema version' },
    ]);
  });
});
