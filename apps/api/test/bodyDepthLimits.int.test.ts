import { htmlToRichText } from '@shapio/schema/html';
import { getIntrospectionQuery } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../src/config/schema.js';
import { createDb, setDb } from '../src/db/index.js';
import { MAX_ARGUMENT_DEPTH } from '../src/schema/codegen/graphql/documentDepth.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const GRAPHQL_MAX_TOKENS_DEFAULT = CONFIG_DEFAULTS.GRAPHQL_MAX_TOKENS;

type GraphqlBody = { data: unknown; errors?: Array<{ message: string; extensions?: { code?: string } }> };
type Item = { id: string };

/** A GraphQL literal `depth` levels deep (`JSON_DEPTH` counting), alternating lists and objects. */
const literal = (depth: number): string => {
  let text = '1';
  for (let level = 1; level < depth; level += 1) {
    text = level % 2 ? `[${text}]` : `{a: ${text}}`;
  }
  return text;
};

/**
 * Review 7: the body depth limit for what a GraphQL document writes itself (N4), the configurable body size
 * limit (N5), the item ID key never created inside a write that rolls back (N9a), and rich text converted from
 * HTML within the body depth limit (N9c).
 */
describe('request limits: depth, size, and the item ID key', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let page: ModelBody;
  let alice: AppSessionBody;

  const graphql = (query: string, token = alice.accessToken) =>
    testApp.app.inject({ method: 'POST', url: '/api/graphql', headers: bearer(token), payload: { query } });
  const answer = (response: { statusCode: number; json: <T>() => T }) => [
    response.statusCode,
    response.json<GraphqlBody>().errors?.map((error) => error.extensions?.code) ?? [],
  ];

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const section = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'section',
        label: 'Section',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string', required: true },
          { apiKey: 'text', label: 'Text', type: 'richtext' },
        ],
      },
      'components',
    );
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'blob', label: 'Blob', type: 'json' },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'component',
          settings: { component: section.definition.id, repeatable: true },
        },
      ],
    });
    alice = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${alice.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(
              database.current.db,
              (['read', 'create', 'update'] as const).map((action) => ({
                action,
                modelId: page.definition.id,
              })),
            ),
          ],
        },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  describe('N4: values written as literals in a GraphQL document', () => {
    it('takes an argument as deep as a REST body allows, and refuses one level more (422 BODY_TOO_DEEP)', async () => {
      // `data` holds the value one level down: the argument is `MAX_ARGUMENT_DEPTH` deep at most.
      const create = (blobDepth: number) =>
        graphql(`mutation { createPage(data: { title: "g", blob: ${literal(blobDepth)} }) { id } }`);
      expect(answer(await create(MAX_ARGUMENT_DEPTH - 1))).toEqual([200, []]);
      expect(answer(await create(MAX_ARGUMENT_DEPTH))).toEqual([422, ['BODY_TOO_DEEP']]);
      expect(answer(await create(100))).toEqual([422, ['BODY_TOO_DEEP']]);
    });

    it('refuses a document thousands of levels deep before parsing it, as a query too deep (never a 500)', async () => {
      for (const depth of [1001, 5001]) {
        expect(answer(await create(depth))).toEqual([400, ['QUERY_TOO_DEEP']]);
      }
      // Brackets inside a string and a comment are text, not nesting.
      const brackets = '['.repeat(300);
      expect(
        answer(
          await graphql(`mutation {
            # ${brackets}
            createPage(data: { title: "${brackets}" }) { id }
          }`),
        ),
      ).toEqual([200, []]);
      async function create(depth: number) {
        return graphql(`mutation { createPage(data: { title: "g", blob: ${literal(depth)} }) { id } }`);
      }
    });
  });

  describe('N5: the request body size limit', () => {
    it('is configurable (REQUEST_BODY_MAX_BYTES), 1 MiB by default', async () => {
      const body = { data: { title: 'x'.repeat(8 * 1024) } };
      expectStatus(await admin.post('/api/admin/content/page', body), 201);
      const small = await createTestApp(database.current, {
        schemaListen: false,
        env: { REQUEST_BODY_MAX_BYTES: '4096' },
      });
      try {
        const response = await schemaClient(small.app, adminToken).post('/api/admin/content/page', body);
        expect([response.statusCode, response.json<{ error: { code: string } }>().error.code]).toEqual([
          413,
          'PAYLOAD_TOO_LARGE',
        ]);
      } finally {
        await small.app.close();
      }
      const large = await createTestApp(database.current, {
        schemaListen: false,
        env: { REQUEST_BODY_MAX_BYTES: String(4 * 1024 * 1024) },
      });
      try {
        const big = { data: { title: 't', blob: { text: 'x'.repeat(2 * 1024 * 1024) } } };
        expect((await admin.post('/api/admin/content/page', big)).statusCode).toBe(413);
        expectStatus(await schemaClient(large.app, adminToken).post('/api/admin/content/page', big), 201);
      } finally {
        await large.app.close();
      }
    });
  });

  describe('N9a: the item ID key', () => {
    /** A second process on the same database: its own handle, so its own key cache. */
    const boot = async () => {
      const db = createDb({ connectionString: database.current.url, poolMax: 3, strict: true });
      const app = await createTestApp({ ...database.current, db }, { schemaListen: false }).catch(
        async (error: unknown) => {
          await db.destroy();
          throw error;
        },
      );
      return {
        admin: schemaClient(app.app, adminToken),
        close: async () => {
          await app.app.close();
          await db.destroy();
        },
      };
    };
    const storedKey = async () =>
      (
        await database.current.db
          .selectFrom('system_versions')
          .select('item_id_key')
          .executeTakeFirstOrThrow()
      ).item_id_key;
    const clearKey = () =>
      database.current.db
        .updateTable('system_versions')
        .set({ item_id_key: null as never })
        .execute();

    it('stops startup when the stored key is not 64 hexadecimal characters', async () => {
      const original = await storedKey();
      try {
        for (const bad of ['', 'abc', 'zz'.repeat(32), '0'.repeat(63)]) {
          await database.current.db.updateTable('system_versions').set({ item_id_key: bad }).execute();
          await expect(boot()).rejects.toThrow(/item_id_key is not 64 hexadecimal characters/);
          setDb(database.current.db);
        }
      } finally {
        await database.current.db.updateTable('system_versions').set({ item_id_key: original }).execute();
      }
    });

    it('is created at startup when missing, and never inside a write that rolls back', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/page', {
          data: { sections: [{ heading: 'a' }, { heading: 'b' }] },
        }),
        201,
      ).json<EntryBody>();
      // Stored before item IDs existed: read IDs are derived with the key.
      const heads = await database.current.db
        .selectFrom('entry_heads')
        .select(['locale', 'state', 'data'])
        .where('entry_id', '=', entry.id)
        .execute();
      const sectionsId = page.definition.fields.find((field) => field.apiKey === 'sections')?.id as string;
      for (const head of heads) {
        const data = head.data as Record<string, unknown>;
        await database.current.db
          .updateTable('entry_heads')
          .set({
            data: {
              ...data,
              [sectionsId]: (data[sectionsId] as Array<Record<string, unknown>>).map(
                ({ __id: _id, ...rest }) => rest,
              ),
            } as never,
          })
          .where('entry_id', '=', entry.id)
          .where('locale', '=', head.locale)
          .where('state', '=', head.state as never)
          .execute();
      }

      await clearKey();
      const first = await boot();
      expect(await storedKey()).not.toBeNull();
      await first.close();
      setDb(database.current.db);

      // Missing again after startup: the first use is a write that is refused (rolled back).
      await clearKey();
      const second = await boot();
      const third = await boot();
      try {
        const refused = await second.admin.put(`/api/admin/content/page/${entry.id}`, {
          expectedVersion: entry.version,
          // Refused by validation inside the write's transaction, after the key is first needed.
          data: { sections: [{ heading: null }] },
        });
        expect(refused.statusCode).toBe(422);
        expect(await storedKey()).not.toBeNull();
        const read = (process: typeof second) =>
          process.admin
            .get(`/api/admin/content/page/${entry.id}`)
            .then((response) =>
              (expectStatus(response, 200).json<EntryBody>().data.sections as Item[]).map((item) => item.id),
            );
        const ids = await read(second);
        expect(await read(third)).toEqual(ids);
        // IDs one process read are known to the other.
        expectStatus(
          await third.admin.put(`/api/admin/content/page/${entry.id}`, {
            expectedVersion: entry.version,
            data: {
              sections: [
                { id: ids[1], heading: 'b' },
                { id: ids[0], heading: 'a' },
              ],
            },
          }),
          200,
        );
      } finally {
        await second.close();
        await third.close();
        // Each app made its handle the process default (`setDb`): give it back to this file's app.
        setDb(database.current.db);
      }
    });
  });

  describe('N9c: rich text converted from HTML', () => {
    it('stays within the body depth limit, in a field and in a component list', async () => {
      const deep = [
        '<ul><li>a'.repeat(60) + '</li></ul>'.repeat(60),
        '<ol><li><a href="https://example.com"><strong><em><code>a</code></em></strong></a>'.repeat(60) +
          '</li></ol>'.repeat(60),
        '<blockquote>'.repeat(80) +
          '<p><a href="https://example.com"><strong>x</strong></a></p>' +
          '</blockquote>'.repeat(80),
        '<blockquote><ul><li><table><tr><td>'.repeat(20) +
          '<p>x</p>' +
          '</td></tr></table></li></ul></blockquote>'.repeat(20),
      ];
      for (const html of deep) {
        const { document } = htmlToRichText(html);
        expectStatus(
          await admin.post('/api/admin/content/page', {
            data: { title: 'imported', body: document, sections: [{ heading: 'h', text: document }] },
          }),
          201,
        );
      }
    });
  });

  describe('review 8: GraphQL documents never cost more than their size allows, nor answer 500', () => {
    const anonymous = (query: string) =>
      testApp.app.inject({ method: 'POST', url: '/api/graphql', payload: { query } });

    it('ends a comment at a bare carriage return, as the parser does (M3)', async () => {
      for (const prefix of ['', '#c\n', '#c\r', '#c\r\n']) {
        const response = await anonymous(`${prefix}${'{a'.repeat(3000)}${'}'.repeat(3000)}`);
        expect(answer(response)).toEqual([400, ['QUERY_TOO_DEEP']]);
      }
      expect(
        answer(await anonymous(`#c\r{ pages(filters: ${'['.repeat(5000)}${']'.repeat(5000)}) { id } }`)),
      ).toEqual([400, ['QUERY_TOO_DEEP']]);
    });

    it(`refuses a document over GRAPHQL_MAX_TOKENS (${GRAPHQL_MAX_TOKENS_DEFAULT}) before parsing or validating it (M6)`, async () => {
      // `{`, the fields, `}`: one token each.
      const repeated = (fields: number) => `{ ${'__typename '.repeat(fields)}}`;
      expect(answer(await graphql(repeated(GRAPHQL_MAX_TOKENS_DEFAULT - 2)))).toEqual([200, []]);
      expect(answer(await graphql(repeated(GRAPHQL_MAX_TOKENS_DEFAULT - 1)))).toEqual([
        400,
        ['QUERY_TOO_LARGE'],
      ]);
      // The reviewer's 80,000 repeats (about 30 seconds of validation before) and a 3,000-fragment chain (a 500).
      expect(answer(await anonymous(`{ ${'a '.repeat(80_000)}}`))).toEqual([400, ['QUERY_TOO_LARGE']]);
      const chain = (length: number) =>
        `${Array.from({ length }, (_, i) => `fragment f${i} on Query { ...f${i + 1} }`).join(' ')} fragment f${length} on Query { __typename } { ...f0 }`;
      expect(answer(await anonymous(chain(3000)))).toEqual([400, ['QUERY_TOO_LARGE']]);
      // Comments are not tokens: a long comment does not count.
      expect(answer(await graphql(`# ${'x '.repeat(10_000)}\n{ __typename }`))).toEqual([200, []]);
      // Full introspection, as GraphiQL sends it, is far under the limit.
      const introspection = getIntrospectionQuery({
        descriptions: true,
        specifiedByUrl: true,
        directiveIsRepeatable: true,
        schemaDescription: true,
        inputValueDeprecation: true,
      });
      expect(answer(await graphql(introspection, adminToken))).toEqual([200, []]);
    });

    it('answers a chain the stack cannot hold with 400, never 500, whatever the token limit', async () => {
      const unbounded = await createTestApp(database.current, {
        schemaListen: false,
        env: { RATE_LIMIT_MAX: '10000', GRAPHQL_MAX_TOKENS: '1000000' },
      });
      try {
        for (const length of [3000, 20_000]) {
          const query = `${Array.from({ length }, (_, i) => `fragment f${i} on Query { ...f${i + 1} }`).join(' ')} fragment f${length} on Query { __typename } { ...f0 }`;
          const response = await unbounded.app.inject({
            method: 'POST',
            url: '/api/graphql',
            headers: bearer(adminToken),
            payload: { query },
          });
          expect(response.statusCode).toBeLessThan(500);
        }
      } finally {
        await unbounded.app.close();
      }
    });
  });

  describe('review 8 M5: content valid on 0.8.2 stays editable', () => {
    it('saves another item of a list whose item holds rich text 36 node levels deep', async () => {
      let node: Record<string, unknown> = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
      for (let level = 0; level < 33; level += 1) {
        node = { type: 'blockquote', content: [node] };
      }
      const text = { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content: [node] } };
      const entry = expectStatus(
        await admin.post('/api/admin/content/page', {
          data: { title: 't', sections: [{ heading: 'deep', text }, { heading: 'other' }] },
        }),
        201,
      ).json<EntryBody>();
      const read = expectStatus(
        await admin.get(`/api/admin/content/page/${entry.id}`),
        200,
      ).json<EntryBody>();
      const sections = read.data.sections as Array<Record<string, unknown>>;
      expectStatus(
        await admin.put(`/api/admin/content/page/${entry.id}`, {
          expectedVersion: read.version,
          data: { sections: [sections[0], { ...sections[1], heading: 'changed' }] },
        }),
        200,
      );
      expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
      const delivered = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/pages/${entry.id}`,
          headers: bearer(alice.accessToken),
        }),
        200,
      ).json<{ data: { sections: Array<{ heading: string }> } }>();
      expect(delivered.data.sections.map((item) => item.heading)).toEqual(['deep', 'changed']);
    });
  });
});
