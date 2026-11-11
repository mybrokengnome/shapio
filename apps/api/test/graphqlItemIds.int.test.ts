import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Data = Record<string, unknown>;
type Link = { id: string; url: string };
type Card = { id: string; heading?: string; title?: string; links: Link[] };
type Block = ({ __typename: 'Card' } & Card) | ({ __typename: 'Link' } & Link);
type PageRead = { id: string; hero: Card | null; cards: Card[]; blocks: Block[] };

const CARD_SELECTION = (heading: string) => `id ${heading} links { id url }`;
const PAGE_QUERY = (heading = 'heading') => `query ($id: ID!, $state: PublicationState) {
  page(id: $id, publicationState: $state) {
    id
    hero { ${CARD_SELECTION(heading)} }
    cards { ${CARD_SELECTION(heading)} }
    blocks { __typename ... on Card { ${CARD_SELECTION(heading)} } ... on Link { id url } }
  }
}`;
const UPDATE_PAGE = `mutation ($id: ID!, $v: Int, $data: PageInput) {
  updatePage(id: $id, expectedVersion: $v, data: $data) { id version }
}`;

/**
 * Component item IDs in GraphQL (plan item-ids): every component item (a single instance, an item of a
 * repeatable component, a zone item, and items nested in them) reads `id: ID!`, the same in today's schema and
 * through an older schema version, and a mutation sending the IDs back after a reorder keeps each item,
 * including the values the caller cannot see.
 */
describe('component item IDs: GraphQL', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let card: ModelBody;
  let alice: AppSessionBody;
  let pageId: string;
  /** The schema version token from before the card's heading was renamed. */
  let olderVersion: string;

  const gql = (query: string, token: string, variables: Data, version?: string) =>
    graphql<Data>(testApp.app, query, {
      headers: { ...bearer(token), ...(version ? { 'shapio-schema-version': version } : {}) },
      variables,
    });
  /** The page as `token` reads it: the draft for the admin, the published version for the app user. */
  const readPage = async (
    token: string,
    { heading = 'heading', version = undefined as string | undefined } = {},
  ) => {
    const result = await gql(
      PAGE_QUERY(heading),
      token,
      { id: pageId, state: token === adminToken ? 'DRAFT' : 'PUBLISHED' },
      version,
    );
    const page = dataOf(result).page as PageRead | null;
    if (!page) {
      throw new Error(`The page did not read: ${result.response.body}`);
    }
    return page;
  };
  /** The app user writes through `version` (today's schema when undefined); the admin publishes the result. */
  const writeAndPublish = async (data: Data, version?: string) => {
    const { version: expected } = await adminView();
    dataOf(await gql(UPDATE_PAGE, alice.accessToken, { id: pageId, v: expected, data }, version));
    expectStatus(await admin.post(`/api/admin/content/page/${pageId}/publish`, {}), 200);
  };
  const adminView = async () =>
    expectStatus(await admin.get(`/api/admin/content/page/${pageId}`), 200).json<EntryBody>();
  /** Every item ID in a page read, in reading order. */
  const idsOf = (page: PageRead): string[] => {
    const cardIds = (item: Card) => [item.id, ...item.links.map((link) => link.id)];
    return [
      ...(page.hero ? cardIds(page.hero) : []),
      ...page.cards.flatMap(cardIds),
      // A card in the zone has links; GraphQL names it by `__typename`, REST by `__component`.
      ...page.blocks.flatMap((block) => ('links' in block ? cardIds(block) : [block.id])),
    ];
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const link = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'link',
        label: 'Link',
        fields: [{ apiKey: 'url', label: 'URL', type: 'string' }],
      },
      'components',
    );
    card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          // Hidden from every delivery caller: it must follow its item when the caller reorders.
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
          {
            apiKey: 'links',
            label: 'Links',
            type: 'component',
            settings: { component: link.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      pluralApiKey: 'pages',
      label: 'Page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: card.definition.id } },
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'blocks',
          label: 'Blocks',
          type: 'dynamiczone',
          settings: { components: [card.definition.id, link.definition.id] },
        },
      ],
    });
    const writer = await createAppRole(database.current.db, [
      { action: 'create', modelId: page.definition.id },
      { action: 'read', modelId: page.definition.id },
      { action: 'update', modelId: page.definition.id },
    ]);
    alice = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${alice.user.id}`,
        payload: { roleIds: [writer] },
      }),
      200,
    );
    // The admin writes the hidden notes, then publishes, so the draft is what every caller reads.
    const created = expectStatus(
      await admin.post('/api/admin/content/page', {
        data: {
          title: 'Home',
          hero: { heading: 'Hero', note: 'hero note', links: [{ url: '/h1' }, { url: '/h2' }] },
          cards: [
            { heading: 'First', note: 'first note', links: [{ url: '/a' }, { url: '/b' }] },
            { heading: 'Second', note: 'second note', links: [] },
          ],
          blocks: [
            { __component: 'card', heading: 'Block card', note: 'block note', links: [{ url: '/c' }] },
            { __component: 'link', url: '/block-link' },
          ],
        },
      }),
      201,
    ).json<EntryBody>();
    pageId = created.id;
    expectStatus(await admin.post(`/api/admin/content/page/${pageId}/publish`, {}), 200);
    olderVersion = expectStatus(
      await testApp.app.inject({ method: 'GET', url: '/api/snapshots/current', headers: bearer(adminToken) }),
      200,
    ).json<{ schemaVersionToken: string }>().schemaVersionToken;
    // Today the card's heading is called `title`; the older version still calls it `heading`.
    const current = (await admin.get(`/api/admin/components/${card.definition.id}`)).json<ModelBody>();
    const response = await admin.put(`/api/admin/components/${card.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map((field: FieldBody) =>
          field.apiKey === 'heading' ? { ...field, apiKey: 'title' } : field,
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202]).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('reads an `id` on single, repeatable, nested, and zone items, the same one REST reads', async () => {
    const page = await readPage(adminToken, { heading: 'title' });
    const ids = idsOf(page);
    // hero + 2 links, 2 cards + 2 links, a zone card + 1 link, a zone link.
    expect(ids).toHaveLength(10);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
    const rest = (await adminView()).data as unknown as PageRead;
    expect(idsOf(rest)).toEqual(ids);
    // Stable: a second read and a delivery caller read the same IDs.
    expect(idsOf(await readPage(adminToken, { heading: 'title' }))).toEqual(ids);
    expect(idsOf(await readPage(alice.accessToken, { heading: 'title' }))).toEqual(ids);
  });

  it('reads the same `id` on every item through an older schema version', async () => {
    const today = await readPage(alice.accessToken, { heading: 'title' });
    const older = await readPage(alice.accessToken, { heading: 'heading', version: olderVersion });
    expect(older.cards.map((item) => item.heading)).toEqual(['First', 'Second']);
    expect(idsOf(older)).toEqual(idsOf(today));
  });

  it('declares `id: ID!` on component types and an optional `id: ID` on their inputs, in both versions', async () => {
    const query = `{
      card: __type(name: "Card") { fields { name type { kind ofType { name } } } }
      input: __type(name: "CardInput") { inputFields { name type { kind name } } }
    }`;
    for (const version of [undefined, olderVersion]) {
      const types = dataOf(await gql(query, adminToken, {}, version)) as {
        card: { fields: Array<{ name: string; type: { kind: string; ofType: { name: string } | null } }> };
        input: { inputFields: Array<{ name: string; type: { kind: string; name: string | null } }> };
      };
      expect(types.card.fields[0]).toEqual({
        name: 'id',
        type: { kind: 'NON_NULL', ofType: { name: 'ID' } },
      });
      expect(types.input.inputFields[0]).toEqual({ name: 'id', type: { kind: 'SCALAR', name: 'ID' } });
    }
  });

  /** Reverses every list, sending each item's ID back, through the given version's names. */
  const reversed = (page: PageRead, heading: 'heading' | 'title') => {
    const cardInput = (item: Card) => ({
      id: item.id,
      [heading]: item[heading],
      links: [...item.links].reverse().map((link) => ({ id: link.id, url: link.url })),
    });
    return {
      hero: page.hero ? cardInput(page.hero) : null,
      cards: [...page.cards].reverse().map(cardInput),
      blocks: [...page.blocks]
        .reverse()
        .map((block) =>
          block.__typename === 'Card'
            ? { card: cardInput(block) }
            : { link: { id: block.id, url: block.url } },
        ),
    };
  };

  /** Each card's hidden note by its ID, as the admin reads it. */
  const notesById = async () => {
    const data = (await adminView()).data as {
      hero: Card & { note: string };
      cards: Array<Card & { note: string }>;
      blocks: Array<Partial<Card> & { __component: string; note?: string; id: string }>;
    };
    return Object.fromEntries(
      [data.hero, ...data.cards, ...data.blocks.filter((block) => block.__component === 'card')].map(
        (item) => [item.id, item.note],
      ),
    );
  };

  const expectReversedKeepingIds = (before: PageRead, after: PageRead) => {
    expect(after.cards.map((item) => item.id)).toEqual(before.cards.map((item) => item.id).reverse());
    expect(after.blocks.map((block) => block.id)).toEqual(before.blocks.map((block) => block.id).reverse());
    expect(after.hero?.links.map((link) => link.id)).toEqual(
      before.hero?.links.map((link) => link.id).reverse(),
    );
    expect(new Set(idsOf(after))).toEqual(new Set(idsOf(before)));
  };

  it('keeps every item, and the values the caller cannot see, when a mutation sends the IDs back after a reorder', async () => {
    const before = await readPage(alice.accessToken, { heading: 'title' });
    const notes = await notesById();
    await writeAndPublish(reversed(before, 'title'));
    const after = await readPage(alice.accessToken, { heading: 'title' });
    expectReversedKeepingIds(before, after);
    expect(after.cards.map((item) => item.title)).toEqual(['Second', 'First']);
    expect(await notesById()).toEqual(notes);
  });

  it('does the same through an older schema version', async () => {
    const before = await readPage(alice.accessToken, { heading: 'heading', version: olderVersion });
    const notes = await notesById();
    await writeAndPublish(reversed(before, 'heading'), olderVersion);
    const after = await readPage(alice.accessToken, { heading: 'heading', version: olderVersion });
    expectReversedKeepingIds(before, after);
    expect(after.cards.map((item) => item.heading)).toEqual(['First', 'Second']);
    expect(await notesById()).toEqual(notes);
  });
});
