import type { InjectOptions } from 'fastify';
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
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type WriteBody = {
  data: { id: string; version: number; status: string };
  meta: { schemaVersion?: { requested: string; current: string } };
};
type ErrorBody = {
  error: { code: string; details?: { issues?: Array<{ path: string; code: string; message: string }> } };
};

/**
 * Writes through a schema lens (plan schema-lenses, limited writes): a client on an older schema version
 * writes in its own names; only fields stored as it reads them are written, everything else is refused or
 * left untouched, and errors name its fields.
 */
describe('schema lens writes', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let note: ModelBody;
  let memo: ModelBody;
  let card: ModelBody;
  let gizmo: ModelBody;
  let alice: AppSessionBody;
  let bob: AppSessionBody;
  let pre: { id: string; version: number };
  let v: string;

  const request = (method: string, url: string, token: string | undefined, payload?: unknown) =>
    testApp.app.inject({
      method: method as InjectOptions['method'],
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
  const at = (url: string) => `${url}${url.includes('?') ? '&' : '?'}schemaVersion=${encodeURIComponent(v)}`;
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/note/${id}`), 200).json<EntryBody>();
  const versionOf = async (id: string) => (await adminView(id)).version;
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({ ...rest, type, settings: {} });
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Record<string, unknown>,
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
  const issuesOf = (response: { json: <T>() => T }) =>
    (response.json<ErrorBody>().error.details?.issues ?? []).map((issue) => [issue.path, issue.code]);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
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
    memo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'memo',
      pluralApiKey: 'memos',
      label: 'Memo',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    gizmo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'gizmo',
      label: 'Gizmo',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const writer = await createAppRole(
      database.current.db,
      [note, memo, gizmo].flatMap((model) => [
        { action: 'create' as const, modelId: model.definition.id },
        { action: 'read' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
        { action: 'update' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
        { action: 'delete' as const, modelId: model.definition.id, condition: 'ownedByPrincipal' as const },
      ]),
    );
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
    pre = expectStatus(
      await request('POST', '/api/content/notes', alice.accessToken, {
        data: {
          title: 'Pre',
          count: 3,
          body: 'plain',
          summary: 's',
          card: { label: 'L' },
          blocks: [{ __component: 'card', label: 'B' }],
        },
      }),
      201,
    ).json<WriteBody>().data;
    expectStatus(await admin.post(`/api/admin/content/note/${pre.id}/publish`, {}), 200);
    v = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;

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
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('creates, updates and partly updates under the old names, and answers with both versions', async () => {
    const created = expectStatus(
      await request('POST', at('/api/content/memos'), alice.accessToken, { data: { name: 'Ann' } }),
      201,
    ).json<WriteBody>();
    expect(created.meta.schemaVersion).toMatchObject({ requested: v });
    expect(created.data).toMatchObject({ version: 1, status: 'draft' });
    const updated = expectStatus(
      await request('PUT', at(`/api/content/memos/${created.data.id}`), alice.accessToken, {
        expectedVersion: 1,
        data: { name: 'Bea' },
      }),
      200,
    ).json<WriteBody>();
    expect(updated.meta.schemaVersion?.requested).toBe(v);
    const memoView = expectStatus(
      await admin.get(`/api/admin/content/memo/${created.data.id}`),
      200,
    ).json<EntryBody>();
    expect(memoView.data).toEqual({ fullName: 'Bea' });

    // A partial update writes the renamed field and leaves everything else alone, added fields included.
    expectStatus(
      await request('PUT', at(`/api/content/notes/${pre.id}`), alice.accessToken, {
        expectedVersion: await versionOf(pre.id),
        data: { title: 'T2' },
      }),
      200,
    );
    expect((await adminView(pre.id)).data).toMatchObject({
      headline: 'T2',
      count: '3',
      subtitle: 'S',
      card: { caption: 'L', extra: 'E' },
      blocks: [{ __component: 'card', caption: 'B', extra: 'Z' }],
    });
    expectStatus(
      await request('DELETE', at(`/api/content/memos/${created.data.id}`), alice.accessToken),
      204,
    );
  });

  it('refuses changed fields with pointers in the old names, saying how they changed', async () => {
    const version = await versionOf(pre.id);
    const refused = await request('PUT', at(`/api/content/notes/${pre.id}`), alice.accessToken, {
      expectedVersion: version,
      data: { count: 4, body: 'changed plain', summary: 'x', headline: 'today' },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json<ErrorBody>().error.code).toBe('LENS_WRITE_UNSUPPORTED');
    expect(issuesOf(refused)).toEqual([
      ['/count', 'NOT_ALLOWED'],
      ['/body', 'NOT_ALLOWED'],
      ['/summary', 'NOT_ALLOWED'],
      ['/headline', 'UNKNOWN_FIELD'],
    ]);
    const messages = refused.json<ErrorBody>().error.details?.issues?.map((issue) => issue.message) ?? [];
    expect(messages[0]).toContain('changed type (integer → string)');
    expect(messages[1]).toContain('changed type (text → richtext)');
    expect(messages[2]).toContain('became shared across locales');
    expect(await versionOf(pre.id)).toBe(version);
  });

  it('accepts a changed field sent back as read and keeps the stored value byte for byte', async () => {
    const before = await adminView(pre.id);
    const read = expectStatus(
      await request('GET', at(`/api/content/notes/${pre.id}`), alice.accessToken),
      200,
    ).json<{ data: Record<string, unknown> }>();
    expect(read.data).toMatchObject({ count: 3, body: 'plain', summary: 's' });
    expectStatus(
      await request('PUT', at(`/api/content/notes/${pre.id}`), alice.accessToken, {
        expectedVersion: before.version,
        data: { title: 'T3', count: read.data.count, body: read.data.body, summary: read.data.summary },
      }),
      200,
    );
    const after = await adminView(pre.id);
    expect(after.data.headline).toBe('T3');
    for (const key of ['count', 'body', 'summary', 'subtitle', 'card', 'blocks']) {
      expect(JSON.stringify(after.data[key])).toBe(JSON.stringify(before.data[key]));
    }
  });

  it('keeps what components and zone items gained when the old client writes them whole', async () => {
    expectStatus(
      await request('PUT', at(`/api/content/notes/${pre.id}`), alice.accessToken, {
        expectedVersion: await versionOf(pre.id),
        data: { card: { label: 'L2' }, blocks: [{ __component: 'card', label: 'B2' }] },
      }),
      200,
    );
    expect((await adminView(pre.id)).data).toMatchObject({
      card: { caption: 'L2', extra: 'E' },
      blocks: [{ __component: 'card', caption: 'B2', extra: 'Z' }],
    });
  });

  it('names its fields in validation errors, and says when a required field came after its version', async () => {
    const version = await versionOf(pre.id);
    const tooLong = await request('PUT', at(`/api/content/notes/${pre.id}`), alice.accessToken, {
      expectedVersion: version,
      data: { title: 'far too long a title', card: { label: 'toolong' } },
    });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json<ErrorBody>().error.code).toBe('CONTENT_INVALID');
    expect(
      issuesOf(tooLong)
        .map(([path]) => path)
        .sort(),
    ).toEqual(['/card/label', '/title']);

    const missing = await request('POST', at('/api/content/notes'), alice.accessToken, {
      data: { title: 'New' },
    });
    expect(missing.statusCode).toBe(422);
    const [issue] = missing.json<ErrorBody>().error.details?.issues ?? [];
    expect(issue).toMatchObject({ path: '/subtitle', code: 'REQUIRED' });
    expect(issue?.message).toContain("added after the client's schema version");
  });

  it('still enforces owner-only updates and answers a model gone since with 404', async () => {
    const response = await request('PUT', at(`/api/content/notes/${pre.id}`), bob.accessToken, {
      expectedVersion: await versionOf(pre.id),
      data: { title: 'Bob' },
    });
    expect(response.statusCode).toBe(404);
    expect((await adminView(pre.id)).data.headline).not.toBe('Bob');
    expect(
      (await request('POST', at('/api/content/gizmos'), alice.accessToken, { data: { name: 'x' } }))
        .statusCode,
    ).toBe(404);
  });

  it('writes today’s shape without a version, and the admin API ignores the version header', async () => {
    const today = await request('PUT', `/api/content/notes/${pre.id}`, alice.accessToken, {
      expectedVersion: await versionOf(pre.id),
      data: { headline: 'Today' },
    });
    expect(today.statusCode).toBe(200);
    expect(today.json<WriteBody>().meta).toEqual({});
    const viaAdmin = await admin.request({
      method: 'PUT',
      url: `/api/admin/content/note/${pre.id}`,
      headers: { 'shapio-schema-version': v },
      payload: { expectedVersion: await versionOf(pre.id), data: { headline: 'Admin' } },
    });
    expect(viaAdmin.statusCode).toBe(200);
    expect((await adminView(pre.id)).data.headline).toBe('Admin');
  });
});
