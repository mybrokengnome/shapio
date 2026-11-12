import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARRY_MAX_ITEMS } from '../src/content/write/listPairing.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ErrorBody = { error: { code: string; details?: { issues?: Array<{ path: string; code: string }> } } };

/**
 * Admin writes cap their component lists like delivery writes (review 6, LOW): a list longer than the field's
 * `max` (at most `CARRY_MAX_ITEMS`) is refused with `TOO_MANY` at its path as soon as the body is read,
 * before the version check, the item pairing or any item ID work, so a huge body costs no more than reading it.
 */
describe('admin writes: component list caps', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let entry: EntryBody;

  const refusal = (response: { statusCode: number; json: <T>() => T }) => [
    response.statusCode,
    response.json<ErrorBody>().error.code,
    (response.json<ErrorBody>().error.details?.issues ?? []).map((issue) => `${issue.path} ${issue.code}`),
  ];
  const items = (count: number, item: (index: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: count }, (_, index) => item(index));

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
      },
      'components',
    );
    const section = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'section',
        label: 'Section',
        fields: [
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true, max: 2 },
          },
        ],
      },
      'components',
    );
    const page: ModelBody = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true, max: 3 },
        },
        {
          apiKey: 'many',
          label: 'Many',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'component',
          settings: { component: section.definition.id, repeatable: true },
        },
      ],
    });
    expect(page.definition.apiKey).toBe('page');
    entry = expectStatus(
      await admin.post('/api/admin/content/page', { data: { cards: [{ heading: 'A' }] } }),
      201,
    ).json<EntryBody>();
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('refuses a create over the field max at the list path', async () => {
    expect(refusal(await admin.post('/api/admin/content/page', { data: { cards: items(4) } }))).toEqual([
      422,
      'CONTENT_INVALID',
      ['/cards TOO_MANY'],
    ]);
    expect(
      refusal(await admin.post('/api/admin/content/page', { data: { sections: [{ items: items(3) }] } })),
    ).toEqual([422, 'CONTENT_INVALID', ['/sections/0/items TOO_MANY']]);
  });

  it('refuses an update and an autosave over the max before the version check and the item pairing', async () => {
    // A stale version (409) and IDs no stored item has (UNKNOWN_ITEM_ID) would each be refused later.
    const body = { data: { cards: items(4, (index) => ({ id: `unknown${index}`, heading: 'x' })) } };
    for (const autosave of [false, true]) {
      expect(
        refusal(
          await admin.put(`/api/admin/content/page/${entry.id}`, {
            ...body,
            expectedVersion: entry.version + 5,
            autosave,
          }),
        ),
      ).toEqual([422, 'CONTENT_INVALID', ['/cards TOO_MANY']]);
    }
    expect((await admin.get(`/api/admin/content/page/${entry.id}`)).json<EntryBody>().version).toBe(
      entry.version,
    );
  });

  it(`refuses ${CARRY_MAX_ITEMS + 1} items on a list without a max`, async () => {
    expect(
      refusal(
        await admin.put(`/api/admin/content/page/${entry.id}`, {
          expectedVersion: entry.version,
          data: { many: items(CARRY_MAX_ITEMS + 1) },
        }),
      ),
    ).toEqual([422, 'CONTENT_INVALID', ['/many TOO_MANY']]);
  });
});
