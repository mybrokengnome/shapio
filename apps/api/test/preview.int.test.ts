import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createRole,
  expectStatus,
  fieldIdOf,
  roleKeyOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type PreviewTokenCreated = {
  token: string;
  previewToken: { id: string; expiresAt: string };
  url: string | null;
};
type PreviewItem = { data: Record<string, unknown>; meta: { preview: boolean; locale: string } };
type PreviewList = { data: Array<Record<string, unknown>>; meta: { preview: boolean } };

const DRAFT_BODY = {
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft body' }] }] },
};

describe('preview tokens and draft reads', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let session: TestSession;
  let editorId: string;
  let draft: EntryBody;
  let other: EntryBody;

  const asAdmin = (options: InjectOptions) =>
    testApp.app.inject({ ...options, headers: { ...session.headers, ...options.headers } });
  const createToken = async (body: Record<string, unknown>) =>
    expectStatus(
      await asAdmin({ method: 'POST', url: '/api/admin/preview/tokens', payload: body }),
      201,
    ).json<PreviewTokenCreated>();
  const preview = (path: string, token: string | undefined) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/preview/content/${path}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'notes', label: 'Internal notes', type: 'string', public: false },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
      ],
    });
    const editor = await createAdmin(database.current.db, { roleKeys: ['editor'] });
    editorId = editor.id;
    session = await login(testApp.app, editor);
    const published = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Live title', notes: 'secret' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${published.id}/publish`, {}), 200);
    draft = expectStatus(
      await admin.put(`/api/admin/content/article/${published.id}`, {
        expectedVersion: (await admin.get(`/api/admin/content/article/${published.id}`)).json<EntryBody>()
          .version,
        data: { title: 'Draft title', notes: 'secret', body: DRAFT_BODY },
      }),
      200,
    ).json<EntryBody>();
    other = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Other draft' } }),
      201,
    ).json<EntryBody>();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('reads the draft of the entry it was made for, in the delivery shape, without non-public fields', async () => {
    const { token, previewToken } = await createToken({ modelKey: 'article', entryId: draft.id });
    expect(token).toMatch(/^shpv_[\w-]+\.[\w-]+$/);
    const item = expectStatus(await preview(`articles/${draft.id}`, token), 200);
    expect(item.headers['cache-control']).toBe('private, no-store');
    const body = item.json<PreviewItem>();
    expect(body.data).toMatchObject({ id: draft.id, title: 'Draft title' });
    expect(body.data).not.toHaveProperty('notes');
    expect(body.meta).toMatchObject({ preview: true, expiresAt: previewToken.expiresAt });

    // The published site still sees the published version; the preview token is not a delivery token.
    expect(
      (
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/articles/${draft.id}`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);

    // Scoped: not another entry, not another model; the list shows only its entry.
    expect((await preview(`articles/${other.id}`, token)).statusCode).toBe(403);
    expect(
      expectStatus(await preview('articles', token), 200)
        .json<PreviewList>()
        .data.map((entry) => entry.id),
    ).toEqual([draft.id]);
  });

  it('returns rich text in the shape the site asks for, the stored document by default', async () => {
    const { token } = await createToken({ modelKey: 'article', entryId: draft.id });
    const read = async (query: string) =>
      expectStatus(await preview(`articles/${draft.id}${query}`, token), 200).json<PreviewItem>().data.body;
    expect(await read('')).toEqual(DRAFT_BODY);
    expect(await read('?richText=html')).toEqual({
      format: 'shapio-richtext',
      version: 1,
      html: '<p>Draft body</p>',
    });
    expect(await read('?richText=both')).toEqual({ ...DRAFT_BODY, html: '<p>Draft body</p>' });
    expect((await preview(`articles/${draft.id}?richText=pdf`, token)).statusCode).toBe(400);
  });

  it('refuses a model-wide token: a preview token previews one entry (sites plan §H)', async () => {
    const response = await asAdmin({
      method: 'POST',
      url: '/api/admin/preview/tokens',
      payload: { modelKey: 'article' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stops working when it expires, is revoked, is forged, or its creator is disabled', async () => {
    const expiring = await createToken({ modelKey: 'article', entryId: draft.id, ttlSeconds: 60 });
    expect((await preview(`articles/${draft.id}`, expiring.token)).statusCode).toBe(200);
    await database.current.db
      .updateTable('preview_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', expiring.previewToken.id)
      .execute();
    expect((await preview(`articles/${draft.id}`, expiring.token)).statusCode).toBe(401);

    const revoked = await createToken({ modelKey: 'article', entryId: draft.id });
    expect(
      (await asAdmin({ method: 'DELETE', url: `/api/admin/preview/tokens/${revoked.previewToken.id}` }))
        .statusCode,
    ).toBe(204);
    expect((await preview(`articles/${draft.id}`, revoked.token)).statusCode).toBe(401);

    const valid = await createToken({ modelKey: 'article', entryId: draft.id });
    const [random] = valid.token.slice('shpv_'.length).split('.');
    expect((await preview(`articles/${draft.id}`, `shpv_${random ?? ''}.forgedmac`)).statusCode).toBe(401);
    expect((await preview(`articles/${draft.id}`, undefined)).statusCode).toBe(401);

    await database.current.db
      .updateTable('admin_users')
      .set({ status: 'disabled' })
      .where('id', '=', editorId)
      .execute();
    try {
      expect((await preview(`articles/${draft.id}`, valid.token)).statusCode).toBe(401);
    } finally {
      await database.current.db
        .updateTable('admin_users')
        .set({ status: 'active' })
        .where('id', '=', editorId)
        .execute();
    }
  });

  it('renders the preview URL from a connection template for the entry form’s Preview button', async () => {
    await admin.post('/api/admin/deployments/connections', {
      name: 'Site',
      provider: 'generic_webhook',
      settings: { url: 'https://build.example.test/hook' },
      secrets: {},
      triggerPolicy: ['manual'],
      previewUrlTemplate: 'https://preview.example.test/{path}?token={token}',
    });
    const opened = expectStatus(
      await asAdmin({
        method: 'POST',
        url: '/api/admin/preview/open',
        payload: { modelKey: 'article', entryId: draft.id },
      }),
      200,
    ).json<{ url: string; apiUrl: string; token: string }>();
    expect(opened.url).toBe(
      `https://preview.example.test/articles/${draft.id}?token=${encodeURIComponent(opened.token)}`,
    );
    expect(opened.apiUrl).toContain(`/api/preview/content/articles/${draft.id}`);
    expect(
      expectStatus(await preview(`articles/${draft.id}`, opened.token), 200).json<PreviewItem>().data.title,
    ).toBe('Draft title');
  });

  it('a token bound to a delivery role shows exactly what that role reads, within the creator’s access', async () => {
    const titleId = fieldIdOf(article, 'title');
    const notesId = fieldIdOf(article, 'notes');
    // The site's role grants the non-public "notes" field explicitly.
    const siteRole = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id, fieldIds: [titleId, notesId] },
    ]);
    const bound = await createToken({ modelKey: 'article', entryId: draft.id, deliveryRoleId: siteRole });
    expect(bound.previewToken).toMatchObject({ deliveryRoleId: siteRole });
    expect(
      expectStatus(await preview(`articles/${draft.id}`, bound.token), 200).json<PreviewItem>().data,
    ).toMatchObject({
      title: 'Draft title',
      notes: 'secret',
    });

    // A role that cannot read the model previews nothing; one that names only "title" hides "notes".
    const otherModelRole = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: null, fieldIds: [] },
    ]);
    const titleOnly = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id, fieldIds: [titleId] },
    ]);
    const narrow = await createToken({ modelKey: 'article', entryId: draft.id, deliveryRoleId: titleOnly });
    expect(
      expectStatus(await preview(`articles/${draft.id}`, narrow.token), 200).json<PreviewItem>().data,
    ).not.toHaveProperty('notes');
    const blind = await createToken({
      modelKey: 'article',
      entryId: draft.id,
      deliveryRoleId: otherModelRole,
    });
    expect(
      Object.keys(
        expectStatus(await preview(`articles/${draft.id}`, blind.token), 200).json<PreviewItem>().data,
      ),
    ).not.toContain('title');

    // The creator can only read "title": the bound role cannot widen that.
    const limitedRole = await createRole(database.current.db, 'admin', [
      { action: 'read', modelId: article.definition.id, fieldIds: [titleId] },
    ]);
    const limited = await createAdmin(database.current.db, {
      roleKeys: [await roleKeyOf(database.current.db, limitedRole)],
    });
    const limitedSession = await login(testApp.app, limited);
    const limitedToken = expectStatus(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/preview/tokens',
        headers: limitedSession.headers,
        payload: { modelKey: 'article', entryId: draft.id, deliveryRoleId: siteRole },
      }),
      201,
    ).json<PreviewTokenCreated>();
    const limitedRead = expectStatus(
      await preview(`articles/${draft.id}`, limitedToken.token),
      200,
    ).json<PreviewItem>();
    expect(limitedRead.data).toMatchObject({ title: 'Draft title' });
    expect(limitedRead.data).not.toHaveProperty('notes');

    // Only delivery roles can be bound.
    const adminRole = await createRole(database.current.db, 'admin', [{ action: 'read', modelId: null }]);
    expect(
      (
        await asAdmin({
          method: 'POST',
          url: '/api/admin/preview/tokens',
          payload: { modelKey: 'article', deliveryRoleId: adminRole },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('tokens from a connection’s Preview follow the connection’s delivery role', async () => {
    const siteRole = await createRole(database.current.db, 'delivery', [
      {
        action: 'read',
        modelId: article.definition.id,
        fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'notes')],
      },
    ]);
    const created = expectStatus(
      await admin.post('/api/admin/deployments/connections', {
        name: 'Bound site',
        provider: 'generic_webhook',
        settings: { url: 'https://build.example.test/bound' },
        secrets: {},
        triggerPolicy: ['manual'],
        previewUrlTemplate: 'https://bound.example.test/{path}?token={token}',
        deliveryRoleId: siteRole,
      }),
      201,
    ).json<{ connection: { id: string; deliveryRoleId: string } }>();
    expect(created.connection.deliveryRoleId).toBe(siteRole);
    const opened = expectStatus(
      await asAdmin({
        method: 'POST',
        url: '/api/admin/preview/open',
        payload: { modelKey: 'article', entryId: draft.id, connectionId: created.connection.id },
      }),
      200,
    ).json<{ token: string }>();
    expect(
      expectStatus(await preview(`articles/${draft.id}`, opened.token), 200).json<PreviewItem>().data,
    ).toMatchObject({
      notes: 'secret',
    });
  });

  it('needs read permission on the model to create a token', async () => {
    const noAccess = await createAdmin(database.current.db, { roleKeys: [] });
    const noAccessSession = await login(testApp.app, noAccess);
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/preview/tokens',
      headers: noAccessSession.headers,
      payload: { modelKey: 'article', entryId: draft.id },
    });
    expect(response.statusCode).toBe(403);
  });

  it('a token for one model never previews another model, by list or by entry', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const page = expectStatus(
      await admin.post('/api/admin/content/page', { data: { title: 'Page draft' } }),
      201,
    ).json<EntryBody>();
    const entryToken = (await createToken({ modelKey: 'article', entryId: draft.id })).token;
    for (const token of [entryToken]) {
      for (const path of ['pages', `pages/${page.id}`]) {
        const response = await preview(path, token);
        expect(response.statusCode, path).toBe(403);
        expect(response.body, path).not.toContain('Page draft');
      }
      // The article entry ID under the other model's path is refused too.
      expect((await preview(`pages/${draft.id}`, token)).statusCode).toBe(403);
    }
    // A token for the page model reads it, so the refusals above are about scope.
    const pageToken = (await createToken({ modelKey: 'page', entryId: page.id })).token;
    expect(
      expectStatus(await preview(`pages/${page.id}`, pageToken), 200).json<PreviewItem>().data,
    ).toMatchObject({ id: page.id, title: 'Page draft' });
    expect((await preview(`articles/${draft.id}`, pageToken)).statusCode).toBe(403);
  });
});
