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
import { dataOf, errorCodes, graphql, GRAPHQL_ENV, type GraphqlResult } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Data = Record<string, unknown>;
type Issue = { path: string; code: string; message: string };
type EntryState = { id: string; version: number; status: string };

const UPDATE_NOTE = `mutation ($id: ID!, $v: Int, $data: NoteInput) {
  updateNote(id: $id, expectedVersion: $v, data: $data) { id version status }
}`;

const MUTATION_TYPE = `{ __schema { mutationType { fields { name args { name type { kind name ofType { kind name } } } } } } }`;

/**
 * GraphQL mutations through a schema lens (plan schema-lenses, limited writes): a client on an older schema
 * version runs its own mutations, in its own names and input types; the delivery write service writes the
 * fields stored as it reads them, refuses the rest (`LENS_WRITE_UNSUPPORTED`, with every issue) unless sent
 * back as read, keeps values it does not know, and names its fields in validation errors.
 */
describe('schema lens writes: GraphQL', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let note: ModelBody;
  let memo: ModelBody;
  let card: ModelBody;
  let gizmo: ModelBody;
  let promo: ModelBody;
  let alice: AppSessionBody;
  let bob: AppSessionBody;
  let pre: { id: string };
  let v: string;
  /** Today's Mutation type, before any lens schema exists. */
  let mutationTypeBefore: string;

  const gql = (
    query: string,
    token: string,
    { version, variables }: { version?: string; variables?: Data } = {},
  ) =>
    graphql<Data>(testApp.app, query, {
      headers: { ...bearer(token), ...(version ? { 'shapio-schema-version': version } : {}) },
      ...(variables ? { variables } : {}),
    });
  const old = (query: string, token: string, variables?: Data) =>
    gql(query, token, { version: v, ...(variables ? { variables } : {}) });
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/note/${id}`), 200).json<EntryBody>();
  const versionOf = async (id: string) => (await adminView(id)).version;
  const updateNote = async (data: Data, token = alice.accessToken) =>
    old(UPDATE_NOTE, token, { id: pre.id, v: await versionOf(pre.id), data });
  const issuesOf = (result: GraphqlResult<Data>) =>
    ((result.body.errors?.[0]?.extensions?.issues ?? []) as Issue[]).map((issue) => [issue.path, issue.code]);
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({ ...rest, type, settings: {} });
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Data,
    kind: 'models' | 'components' = 'models',
  ) => {
    const current = (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
    const response = await admin.put(`/api/admin/${kind}/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      throw new Error(
        `Changing ${current.definition.apiKey} failed: ${response.statusCode} ${response.body}`,
      );
    }
    await runContentSchemaJobs(database.current.db);
    return (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      pluralApiKey: 'notes',
      label: 'Note',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'count', label: 'Count', type: 'integer' },
        { apiKey: 'body', label: 'Body', type: 'text' },
        { apiKey: 'summary', label: 'Summary', type: 'string', localized: true },
        { apiKey: 'card', label: 'Card', type: 'component', settings: { component: card.definition.id } },
        {
          apiKey: 'blocks',
          label: 'Blocks',
          type: 'dynamiczone',
          settings: { components: [card.definition.id] },
        },
      ],
    });
    const simple = (apiKey: string, label: string) =>
      createDefinition(admin, {
        kind: 'collection',
        apiKey,
        label,
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
    memo = await simple('memo', 'Memo');
    gizmo = await simple('gizmo', 'Gizmo');
    promo = await simple('promo', 'Promo');
    const board = await simple('board', 'Board');
    const writer = await createAppRole(database.current.db, [
      ...[note, memo, gizmo, promo].flatMap((model) => [
        { action: 'create' as const, modelId: model.definition.id },
        { action: 'read' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
        { action: 'update' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
        { action: 'delete' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
      ]),
      // Read only: the mutations exist, as in today's schema, and are refused.
      { action: 'read' as const, modelId: board.definition.id },
    ]);
    alice = await signUp(testApp.app);
    bob = await signUp(testApp.app);
    for (const user of [alice, bob]) {
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${user.user.id}`,
          payload: { roleIds: [writer] },
        }),
        200,
      );
    }
    const created = dataOf(
      await gql(`mutation ($data: NoteInput) { createNote(data: $data) { id } }`, alice.accessToken, {
        variables: {
          data: {
            title: 'Pre',
            count: 3,
            body: 'plain',
            summary: 's',
            card: { label: 'L' },
            blocks: [{ card: { label: 'B' } }],
          },
        },
      }),
    );
    pre = created.createNote as { id: string };
    expectStatus(await admin.post(`/api/admin/content/note/${pre.id}/publish`, {}), 200);
    v = expectStatus(
      await testApp.app.inject({ method: 'GET', url: '/api/snapshots/current', headers: bearer(adminToken) }),
      200,
    ).json<{ schemaVersionToken: string }>().schemaVersionToken;

    card = await change(
      card,
      (definition) => ({
        ...definition,
        fields: [
          { ...field(definition, 'label'), apiKey: 'caption', settings: { maxLength: 5 } },
          { apiKey: 'extra', label: 'Extra', type: 'string' },
        ],
      }),
      'components',
    );
    note = await change(note, (definition) => ({
      ...definition,
      fields: [
        { ...field(definition, 'title'), apiKey: 'headline', settings: { maxLength: 10 } },
        retype(field(definition, 'count'), 'string'),
        retype(field(definition, 'body'), 'richtext'),
        { ...field(definition, 'summary'), localized: false },
        field(definition, 'card'),
        field(definition, 'blocks'),
        { apiKey: 'subtitle', label: 'Subtitle', type: 'string', required: true },
      ],
    }));
    memo = await change(memo, (definition) => ({
      ...definition,
      pluralApiKey: 'notices',
      fields: [{ ...field(definition, 'name'), apiKey: 'fullName' }],
    }));
    promo = await change(promo, (definition) => ({
      ...definition,
      kind: 'singleton',
      pluralApiKey: undefined,
    }));
    expectStatus(
      await admin.delete(
        `/api/admin/models/${gizmo.definition.id}?expectedVersion=${gizmo.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
    // Values the old client does not know, set by today's editors.
    const current = await adminView(pre.id);
    expectStatus(
      await admin.put(`/api/admin/content/note/${pre.id}`, {
        expectedVersion: current.version,
        data: {
          subtitle: 'S',
          card: { caption: 'L', extra: 'E' },
          blocks: [{ __component: 'card', caption: 'B', extra: 'Z' }],
        },
      }),
      200,
    );
    mutationTypeBefore = (await gql(MUTATION_TYPE, adminToken)).response.body;
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('shows the old version’s mutations and input types', async () => {
    type Introspected = { __schema: { mutationType: { fields: Array<{ name: string }> } } };
    const names = (
      dataOf(await old(MUTATION_TYPE, adminToken)) as Introspected
    ).__schema.mutationType.fields.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(['createNote', 'updateMemo', 'createPromo', 'deleteNote']));
    expect(names).not.toContain('createGizmo');
    const input = dataOf(await old('{ __type(name: "NoteInput") { inputFields { name } } }', adminToken)) as {
      __type: { inputFields: Array<{ name: string }> };
    };
    expect(input.__type.inputFields.map(({ name }) => name)).toEqual([
      'title',
      'count',
      'body',
      'summary',
      'card',
      'blocks',
    ]);
  });

  it('creates, updates, partly updates and deletes under the old names', async () => {
    const created = await old(
      `mutation { createMemo(data: { name: "Ann" }) { id version status } }`,
      alice.accessToken,
    );
    const entry = dataOf(created).createMemo as EntryState;
    expect(entry).toMatchObject({ version: 1, status: 'draft' });
    expect(created.body).toMatchObject({ extensions: { schemaVersion: { requested: v } } });
    dataOf(
      await old(
        `mutation ($id: ID!) { updateMemo(id: $id, expectedVersion: 1, data: { name: "Bea" }) { version } }`,
        alice.accessToken,
        { id: entry.id },
      ),
    );
    const memoView = expectStatus(
      await admin.get(`/api/admin/content/memo/${entry.id}`),
      200,
    ).json<EntryBody>();
    expect(memoView.data).toEqual({ fullName: 'Bea' });

    // A partial update writes the renamed field and leaves everything else alone, added fields included.
    dataOf(await updateNote({ title: 'T2' }));
    expect((await adminView(pre.id)).data).toMatchObject({
      headline: 'T2',
      count: '3',
      subtitle: 'S',
      card: { caption: 'L', extra: 'E' },
      blocks: [{ __component: 'card', caption: 'B', extra: 'Z' }],
    });
    const deleted = await old(`mutation ($id: ID!) { deleteMemo(id: $id) }`, alice.accessToken, {
      id: entry.id,
    });
    expect(dataOf(deleted)).toEqual({ deleteMemo: entry.id });
    expect((await admin.get(`/api/admin/content/memo/${entry.id}`)).statusCode).toBe(404);
  });

  it('refuses changed fields with every issue in the old names', async () => {
    const version = await versionOf(pre.id);
    const refused = await updateNote({ count: 4, body: 'changed plain', summary: 'x' });
    expect(refused.statusCode).toBe(200);
    expect(refused.body.data).toEqual({ updateNote: null });
    expect(errorCodes(refused)).toEqual(['LENS_WRITE_UNSUPPORTED']);
    expect(issuesOf(refused)).toEqual([
      ['/count', 'NOT_ALLOWED'],
      ['/body', 'NOT_ALLOWED'],
      ['/summary', 'NOT_ALLOWED'],
    ]);
    const messages = ((refused.body.errors?.[0]?.extensions?.issues ?? []) as Issue[]).map((i) => i.message);
    expect(messages[0]).toContain('changed type (integer → string)');
    expect(await versionOf(pre.id)).toBe(version);
  });

  it('accepts a changed field sent back as read and keeps the stored value byte for byte', async () => {
    const before = await adminView(pre.id);
    const read = dataOf(
      await old('query ($id: ID!) { note(id: $id) { count body summary } }', alice.accessToken, {
        id: pre.id,
      }),
    ).note as Data;
    expect(read).toEqual({ count: 3, body: 'plain', summary: 's' });
    dataOf(await updateNote({ title: 'T3', ...read }));
    const after = await adminView(pre.id);
    expect(after.data.headline).toBe('T3');
    for (const key of ['count', 'body', 'summary', 'subtitle', 'card', 'blocks']) {
      expect(JSON.stringify(after.data[key])).toBe(JSON.stringify(before.data[key]));
    }
  });

  it('keeps what components and zone items gained when the old client writes them whole', async () => {
    // Alice cannot read the draft (it has unpublished changes), so a zone sent without item IDs is refused:
    // the zone's component holds a field she cannot see, and nothing says which item she means.
    const unnamed = await updateNote({ card: { label: 'L2' }, blocks: [{ card: { label: 'B2' } }] });
    expect(errorCodes(unnamed)).toEqual(['CONTENT_INVALID']);
    const { issues } = unnamed.body.errors?.[0]?.extensions?.details as { issues: Issue[] };
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([['/blocks', 'AMBIGUOUS_ITEMS']]);
    // Named by its ID, the zone item is kept with what it gained.
    const [block] = (await adminView(pre.id)).data.blocks as Array<{ id: string }>;
    dataOf(await updateNote({ card: { label: 'L2' }, blocks: [{ card: { id: block?.id, label: 'B2' } }] }));
    expect((await adminView(pre.id)).data).toMatchObject({
      subtitle: 'S',
      card: { caption: 'L2', extra: 'E' },
      blocks: [{ __component: 'card', caption: 'B2', extra: 'Z' }],
    });
  });

  it('names its fields in validation errors, and says when a required field came after its version', async () => {
    const tooLong = await updateNote({ title: 'far too long a title', card: { label: 'toolong' } });
    expect(errorCodes(tooLong)).toEqual(['CONTENT_INVALID']);
    const details = tooLong.body.errors?.[0]?.extensions?.details as { issues: Issue[] };
    expect(details.issues.map((issue) => issue.path).sort()).toEqual(['/card/label', '/title']);
    const missing = await old(`mutation { createNote(data: { title: "New" }) { id } }`, alice.accessToken);
    expect(errorCodes(missing)).toEqual(['CONTENT_INVALID']);
    const [issue] = (missing.body.errors?.[0]?.extensions?.details as { issues: Issue[] }).issues;
    expect(issue).toMatchObject({ path: '/subtitle', code: 'REQUIRED' });
    expect(issue?.message).toContain("added after the client's schema version");
  });

  it('keeps owner-only updates, refuses models the caller cannot write, a kind change and a deleted model', async () => {
    const bobs = await updateNote({ title: 'Bob' }, bob.accessToken);
    expect(errorCodes(bobs)).toEqual(['ENTRY_NOT_FOUND']);
    expect((await adminView(pre.id)).data.headline).not.toBe('Bob');
    // As in today's schema, a model the caller may only read has its mutations (no write fields: no input).
    const board = await old(`mutation { createBoard { id } }`, alice.accessToken);
    expect(errorCodes(board)).toEqual(['FORBIDDEN']);
    const promoted = await old(`mutation { createPromo(data: { name: "x" }) { id } }`, alice.accessToken);
    expect(errorCodes(promoted)).toEqual(['LENS_UNCOVERED']);
    const gone = await old(`mutation { createGizmo(data: { name: "x" }) { id } }`, alice.accessToken);
    expect(gone.statusCode).toBe(400);
    expect(errorCodes(gone)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
  });

  it('records no schema version for app users, who are counted together', async () => {
    dataOf(await old('query ($id: ID!) { note(id: $id) { title } }', alice.accessToken, { id: pre.id }));
    await testApp.app.usage.flush();
    const { principals } = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: '/api/admin/usage/schema-versions',
        headers: bearer(adminToken),
      }),
      200,
    ).json<{ principals: Array<{ principalKey: string; schemaVersion: number | null }> }>();
    expect(principals.filter((entry) => entry.principalKey === 'app_users')).toEqual([]);
  });

  it('leaves today’s mutations byte for byte as they were while lens schemas are cached', async () => {
    expect(testApp.app.graphqlRuntime.schemas.listLens().length).toBeGreaterThan(0);
    expect((await gql(MUTATION_TYPE, adminToken)).response.body).toBe(mutationTypeBefore);
    const today = await gql(UPDATE_NOTE, alice.accessToken, {
      variables: { id: pre.id, v: await versionOf(pre.id), data: { headline: 'Today' } },
    });
    expect(Object.keys(today.body)).toEqual(['data']);
    expect(dataOf(today).updateNote).toMatchObject({ id: pre.id, status: expect.any(String) as string });
    expect((await adminView(pre.id)).data.headline).toBe('Today');
  });
});
