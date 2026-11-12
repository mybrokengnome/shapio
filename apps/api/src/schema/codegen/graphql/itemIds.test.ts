import { normalizeDefinition, type DefinitionInput, type SchemaDefinition } from '@shapio/schema';
import {
  assertValidSchema,
  GraphQLID,
  isNonNullType,
  isUnionType,
  type GraphQLInputObjectType,
  type GraphQLObjectType,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { createBuild } from './build.js';
import { createFixedTypes } from './fixedTypes.js';
import { toWriteData } from './inputTypes.js';
import { lensVisibility } from './lensVisibility.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { FULL_VISIBILITY, type SchemaVisibility } from './visibility.js';

/** Component item IDs in GraphQL (plan item-ids): `id: ID!` on outputs, optional `id: ID` on inputs. */
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

const LINK = uuid(1);
const CARD = uuid(2);
const SECRET_BOX = uuid(3);
const PAGE = uuid(4);

const string = (id: number, apiKey: string, isPublic = true) => ({
  id: uuid(id),
  apiKey,
  label: apiKey,
  type: 'string' as const,
  public: isPublic,
});

/** A card holds a list of links (nested); a page holds a card, a list of cards, and a zone of both. */
const definitions = (cardTitleKey: string) => [
  define({ id: LINK, kind: 'component', apiKey: 'link', label: 'Link', fields: [string(11, 'url')] }),
  define({
    id: CARD,
    kind: 'component',
    apiKey: 'card',
    label: 'Card',
    fields: [
      string(21, cardTitleKey),
      {
        id: uuid(22),
        apiKey: 'links',
        label: 'Links',
        type: 'component',
        settings: { component: LINK, repeatable: true },
      },
    ],
  }),
  define({
    id: SECRET_BOX,
    kind: 'component',
    apiKey: 'secretBox',
    label: 'Secret box',
    fields: [string(31, 'secret', false)],
  }),
  define({
    id: PAGE,
    kind: 'collection',
    apiKey: 'page',
    label: 'Page',
    fields: [
      string(41, 'title'),
      { id: uuid(42), apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: CARD } },
      {
        id: uuid(43),
        apiKey: 'cards',
        label: 'Cards',
        type: 'component',
        settings: { component: CARD, repeatable: true },
      },
      {
        id: uuid(44),
        apiKey: 'blocks',
        label: 'Blocks',
        type: 'dynamiczone',
        settings: { components: [CARD, LINK, SECRET_BOX] },
      },
    ],
  }),
];

const LOCALES = [{ code: 'en', label: 'English', isDefault: true, fallbacks: [] }] as never;
const current = buildSnapshot(9, definitions('heading').map(active), LOCALES);
/** An older version: the card's heading was called `title`. */
const older = buildSnapshot(4, definitions('title').map(active), LOCALES);

/** A delivery caller reading and writing every public field of the page. */
const PUBLIC_CALLER: SchemaVisibility = {
  key: 'delivery:item-ids-test',
  models: new Map([
    [
      PAGE,
      {
        readable: true,
        readFields: new Set([uuid(41), uuid(42), uuid(43), uuid(44)]),
        writeFields: new Set([uuid(41), uuid(42), uuid(43), uuid(44)]),
        unrestrictedRead: true,
        unrestrictedWrite: true,
      },
    ],
  ]),
  componentFields: 'public',
};

const objectType = (schema: ReturnType<typeof buildGraphqlSchema>['schema'], name: string) =>
  schema.getType(name) as GraphQLObjectType;
const inputType = (schema: ReturnType<typeof buildGraphqlSchema>['schema'], name: string) =>
  schema.getType(name) as GraphQLInputObjectType;

const SCHEMAS = {
  'the current schema (admin)': () => buildGraphqlSchema(current).schema,
  'the current schema (delivery)': () => buildGraphqlSchema(current, PUBLIC_CALLER).schema,
  'an older version (admin)': () =>
    buildGraphqlSchema(older, lensVisibility(FULL_VISIBILITY, older, current), { lens: true }).schema,
  'an older version (delivery)': () =>
    buildGraphqlSchema(older, lensVisibility(PUBLIC_CALLER, older, current), { lens: true }).schema,
};

describe('component item IDs in GraphQL', () => {
  describe.each(Object.entries(SCHEMAS))('%s', (_name, schemaOf) => {
    const schema = schemaOf();

    it('gives every component type a required `id` first, and every component input an optional one', () => {
      expect(() => assertValidSchema(schema)).not.toThrow();
      for (const name of ['Card', 'Link']) {
        const fields = objectType(schema, name).getFields();
        expect(Object.keys(fields)[0]).toBe('id');
        const type = fields.id?.type;
        expect(isNonNullType(type) && type.ofType).toBe(GraphQLID);
        const input = inputType(schema, `${name}Input`).getFields();
        expect(Object.keys(input)[0]).toBe('id');
        expect(input.id?.type).toBe(GraphQLID);
      }
    });

    it('reads `id` from the item the projection serves', () => {
      const resolve = objectType(schema, 'Card').getFields().id?.resolve;
      expect(resolve?.({ data: { id: 'item-1' }, scope: {} }, {}, {}, {} as never)).toBe('item-1');
    });

    it('gives the zone members `id` and keeps zone item inputs per component', () => {
      const zone = schema.getType('PageBlocksZone');
      const members = isUnionType(zone) ? zone.getTypes() : [];
      expect(members.map((type) => type.name)).toEqual(expect.arrayContaining(['Card', 'Link']));
      for (const member of members) {
        expect(Object.keys(member.getFields())[0]).toBe('id');
      }
      expect(Object.keys(inputType(schema, 'PageBlocksZoneInput').getFields())).toEqual(
        expect.arrayContaining(['card', 'link']),
      );
    });
  });

  it("keeps a component whose every field is hidden out of a delivery caller's schema (`id` does not count)", () => {
    const schema = buildGraphqlSchema(current, PUBLIC_CALLER).schema;
    expect(schema.getType('SecretBox')).toBeUndefined();
    expect(schema.getType('SecretBoxInput')).toBeUndefined();
    // The admin schema sees the field, so the type is there, with its `id`.
    const admin = buildGraphqlSchema(current).schema;
    expect(Object.keys(objectType(admin, 'SecretBox').getFields())).toEqual(['id', 'secret']);
  });

  it('names the older version its own field names next to `id`', () => {
    const schema = SCHEMAS['an older version (delivery)']();
    expect(Object.keys(objectType(schema, 'Card').getFields())).toEqual(['id', 'title', 'links']);
  });

  describe('toWriteData', () => {
    const page = current.byId.get(PAGE)?.definition as SchemaDefinition;
    const build = createBuild(current, FULL_VISIBILITY, createFixedTypes());

    it('passes every sent item `id` through untouched: single, list, nested, and zone items', () => {
      const input = {
        title: 'Home',
        hero: { id: 'h1', heading: 'Hi', links: [{ id: 'l1', url: '/a' }, { url: '/new' }] },
        cards: [
          { id: 'c2', heading: 'Second' },
          { id: 'c1', heading: 'First', links: [{ id: 'l3', url: '/b' }] },
        ],
        blocks: [{ link: { id: 'z2', url: '/z' } }, { card: { id: 'z1', heading: 'Block' } }],
      };
      expect(toWriteData(build, page, input)).toEqual({
        title: 'Home',
        hero: { id: 'h1', heading: 'Hi', links: [{ id: 'l1', url: '/a' }, { url: '/new' }] },
        cards: [
          { id: 'c2', heading: 'Second' },
          { id: 'c1', heading: 'First', links: [{ id: 'l3', url: '/b' }] },
        ],
        blocks: [
          { __component: 'link', id: 'z2', url: '/z' },
          { __component: 'card', id: 'z1', heading: 'Block' },
        ],
      });
    });

    it('adds no `id` to items sent without one', () => {
      const written = toWriteData(build, page, {
        cards: [{ heading: 'New' }],
        blocks: [{ link: { url: '/' } }],
      });
      expect(written).toEqual({ cards: [{ heading: 'New' }], blocks: [{ __component: 'link', url: '/' }] });
    });
  });
});
