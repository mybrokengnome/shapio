import { randomUUID } from 'node:crypto';
import { SEO_COMPONENT_ID } from '@shapio/schema';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN_DISPLAY_LENGTH, API_TOKEN_PREFIX } from '../src/constants/auth.js';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { generateToken, hashToken } from '../src/helpers/tokens.js';
import * as apiTokensRepository from '../src/repositories/apiTokens.js';
import {
  createDefinition,
  createRole,
  expectStatus,
  fieldIdOf,
  roleKeyOf,
  type EntryBody,
  type GrantSpec,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Seo = {
  title: string | null;
  description: string | null;
  image: { id: string; url: string } | null;
  canonical: string | null;
  noindex: boolean | null;
};
type ArticleBody = {
  id: string;
  locale: string;
  title: string;
  seo: Seo;
  author?: { seo: Seo } | string | null;
};
type SiteSeoBody = { version: number; seo: Record<string, unknown> };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * SEO defaults per site and `?seo=resolved` (plan seo-fields): defaults are edited per site with
 * `site.settings`, merged per head locale into delivered SEO fields, never leak a private image or a hidden
 * title, and never cross sites.
 */
describe('SEO defaults and resolved SEO', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let marketingId: string;
  let article: ModelBody;
  let author: ModelBody;
  let image: MediaAssetBody;
  let secret: MediaAssetBody;
  let marketingImage: MediaAssetBody;
  let token: string;
  let titleHiddenToken: string;
  let marketingToken: string;
  const ids = { bare: '', custom: '', marketing: '', plain: '' };

  const onSite = (site: string | undefined) => ({
    ...(site ? { [SITE_HEADER]: site } : {}),
  });
  const adminRequest = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, site?: string) =>
    admin.request({
      method,
      url,
      headers: onSite(site),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const get = (url: string, headers: Record<string, string> = {}) =>
    testApp.app.inject({ method: 'GET', url, headers });

  /** A delivery token of `siteId` reading the given models. */
  const siteToken = async (siteId: string, grants: GrantSpec[]) => {
    const roleId = await createRole(database.current.db, 'delivery', grants);
    const value = `${API_TOKEN_PREFIX}${generateToken()}`;
    await apiTokensRepository.insert(
      {
        name: `seo ${randomUUID()}`,
        token_hash: hashToken(value),
        token_prefix: value.slice(0, API_TOKEN_DISPLAY_LENGTH),
        role_id: roleId,
        site_id: siteId,
      },
      database.current.db,
    );
    return value;
  };

  const saveSeo = async (seo: Record<string, unknown>, site?: string) => {
    const current = expectStatus(
      await adminRequest('GET', '/api/admin/site/seo', undefined, site),
      200,
    ).json<SiteSeoBody>();
    return adminRequest('PUT', '/api/admin/site/seo', { expectedVersion: current.version, seo }, site);
  };

  const createArticle = async (data: Record<string, unknown>, site?: string, locale = 'en') => {
    const id = expectStatus(
      await adminRequest('POST', '/api/admin/content/article', { locale, data }, site),
      201,
    ).json<EntryBody>().id;
    return id;
  };
  const saveLocale = async (id: string, locale: string, data: Record<string, unknown>) =>
    expectStatus(
      await adminRequest('PUT', `/api/admin/content/article/${id}`, { locale, expectedVersion: null, data }),
      200,
    );
  const publish = async (model: string, id: string, locales: string[], site?: string) =>
    expectStatus(
      await adminRequest('POST', `/api/admin/content/${model}/${id}/publish`, { locales }, site),
      200,
    );

  const read = (url: string, credential = token) => get(url, bearer(credential));
  const seoOf = async (url: string, credential = token) =>
    expectStatus(await read(url, credential), 200).json<{ data: ArticleBody }>().data.seo;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    marketingId = expectStatus(
      await admin.post('/api/admin/sites', { key: 'marketing', name: 'Marketing' }),
      201,
    ).json<{
      id: string;
    }>().id;
    expectStatus(
      await admin.post('/api/admin/locales', { code: 'fr', label: 'French', fallbacks: ['en'] }),
      201,
    );
    expectStatus(await admin.post('/api/admin/components/builtin/seo/ensure', {}), 201);

    const headers = bearer(adminToken);
    image = await uploadAsset(testApp.app, headers, {
      file: await createPng(30, 20),
      filename: 'og.png',
      mimeType: 'image/png',
    });
    secret = await uploadAsset(testApp.app, headers, {
      file: await createPng(10, 10),
      filename: 'secret.png',
      mimeType: 'image/png',
      visibility: 'private',
    });
    marketingImage = await uploadAsset(
      testApp.app,
      { ...headers, [SITE_HEADER]: 'marketing' },
      { file: await createPng(12, 12), filename: 'm.png', mimeType: 'image/png' },
    );

    const seoField = {
      apiKey: 'seo',
      label: 'SEO',
      type: 'component',
      localized: true,
      settings: { component: SEO_COMPONENT_ID },
    };
    author = await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'author',
        label: 'Author',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          { ...seoField, localized: false },
        ],
      },
      'models',
      'network',
    );
    article = await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          seoField,
          {
            apiKey: 'author',
            label: 'Author',
            type: 'relation',
            settings: { target: author.definition.id, cardinality: 'one' },
          },
        ],
      },
      'models',
      'network',
    );
    await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'note',
        label: 'Note',
        fields: [{ apiKey: 'body', label: 'Body', type: 'text' }],
      },
      'models',
      'network',
    );

    const authorId = expectStatus(
      await adminRequest('POST', '/api/admin/content/author', { locale: 'en', data: { name: 'Ada' } }),
      201,
    ).json<EntryBody>().id;
    await publish('author', authorId, ['en']);

    ids.bare = await createArticle({ title: 'Hello', author: authorId });
    await saveLocale(ids.bare, 'fr', { title: 'Bonjour', author: authorId });
    await publish('article', ids.bare, ['en', 'fr']);
    ids.custom = await createArticle({
      title: 'Ignored',
      seo: { title: 'Custom', description: 'Mine', canonical: 'https://example.test/c', noindex: true },
    });
    await publish('article', ids.custom, ['en']);
    ids.marketing = await createArticle({ title: 'Launch' }, 'marketing');
    await publish('article', ids.marketing, ['en'], 'marketing');

    const all = [
      { action: 'read' as const, modelId: article.definition.id },
      { action: 'read' as const, modelId: author.definition.id },
    ];
    token = await siteToken(PRIMARY_SITE_ID, all);
    titleHiddenToken = await siteToken(PRIMARY_SITE_ID, [
      { action: 'read', modelId: article.definition.id, fieldIds: [fieldIdOf(article, 'seo')] },
    ]);
    marketingToken = await siteToken(marketingId, all);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('editing the defaults', () => {
    it('starts empty, saves per site with the version, and refuses a stale version', async () => {
      const empty = expectStatus(await adminRequest('GET', '/api/admin/site/seo'), 200).json<SiteSeoBody>();
      expect(empty.seo).toEqual({ locales: {}, imageId: null, twitterHandle: null });
      const saved = expectStatus(
        await adminRequest('PUT', '/api/admin/site/seo', {
          expectedVersion: empty.version,
          seo: {
            locales: {
              en: { siteName: 'Acme', titleTemplate: '%s · Acme', description: 'Default description' },
              fr: { titleTemplate: '%s · Acmé' },
            },
            imageId: image.id,
            twitterHandle: '@acme',
          },
        }),
        200,
      ).json<SiteSeoBody>();
      expect(saved.version).toBe(empty.version + 1);
      const stale = await adminRequest('PUT', '/api/admin/site/seo', {
        expectedVersion: empty.version,
        seo: { locales: {}, imageId: null, twitterHandle: null },
      });
      expect(stale.statusCode).toBe(409);
      expect(codeOf(stale)).toBe('VERSION_CONFLICT');
    });

    it('records an audit row and a site.updated event for the site', async () => {
      const { db } = database.current;
      const audit = await db
        .selectFrom('audit_events')
        .select(['site_id', 'target_id'])
        .where('action', '=', 'site.seo_update')
        .execute();
      expect(audit).toContainEqual({ site_id: PRIMARY_SITE_ID, target_id: PRIMARY_SITE_ID });
      const events = await db
        .selectFrom('outbox_events')
        .select(['site_id', 'aggregate_id'])
        .where('type', '=', 'site.updated')
        .execute();
      expect(events).toContainEqual({ site_id: PRIMARY_SITE_ID, aggregate_id: PRIMARY_SITE_ID });
    });

    it('refuses unknown locales, templates without exactly one %s, and unusable images', async () => {
      const base = { locales: {}, imageId: null, twitterHandle: null };
      expect(codeOf(await saveSeo({ ...base, locales: { de: { siteName: 'X' } } }))).toBe('UNKNOWN_LOCALE');
      expect(
        (await saveSeo({ ...base, locales: { en: { titleTemplate: 'No placeholder' } } })).statusCode,
      ).toBe(400);
      expect((await saveSeo({ ...base, locales: { en: { titleTemplate: '%s %s' } } })).statusCode).toBe(400);
      expect((await saveSeo({ ...base, twitterHandle: 'acme' })).statusCode).toBe(400);
      expect(codeOf(await saveSeo({ ...base, imageId: secret.id }))).toBe('SEO_IMAGE_INVALID');
      // Another site's asset is not this site's to use.
      expect(codeOf(await saveSeo({ ...base, imageId: marketingImage.id }))).toBe('SEO_IMAGE_INVALID');
    });

    it('lets anyone who reads the site read the defaults, and only site.settings change them', async () => {
      const editor = schemaClient(
        testApp.app,
        await createRoleToken(database.current.db, 'editor', marketingId),
      );
      const read = expectStatus(
        await editor.request({ method: 'GET', url: '/api/admin/site/seo', headers: onSite('marketing') }),
        200,
      ).json<SiteSeoBody>();
      const refused = await editor.request({
        method: 'PUT',
        url: '/api/admin/site/seo',
        headers: onSite('marketing'),
        payload: { expectedVersion: read.version, seo: { locales: {}, imageId: null, twitterHandle: null } },
      });
      expect(refused.statusCode).toBe(403);
      // An admin role that reads no content (custom, no grants) cannot read them either.
      const nobody = schemaClient(
        testApp.app,
        await createRoleToken(
          database.current.db,
          await roleKeyOf(database.current.db, await createRole(database.current.db, 'admin', [])),
          marketingId,
        ),
      );
      expect(
        (await nobody.request({ method: 'GET', url: '/api/admin/site/seo', headers: onSite('marketing') }))
          .statusCode,
      ).toBe(403);
      // The admin role held on the marketing site alone edits that site's defaults.
      const siteAdmin = schemaClient(
        testApp.app,
        await createRoleToken(database.current.db, 'admin', marketingId),
      );
      const current = expectStatus(
        await siteAdmin.request({ method: 'GET', url: '/api/admin/site/seo', headers: onSite('marketing') }),
        200,
      ).json<SiteSeoBody>();
      const saved = await siteAdmin.request({
        method: 'PUT',
        url: '/api/admin/site/seo',
        headers: onSite('marketing'),
        payload: {
          expectedVersion: current.version,
          seo: {
            locales: { en: { siteName: 'Marketing', titleTemplate: '%s | Marketing' } },
            imageId: marketingImage.id,
            twitterHandle: null,
          },
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    });
  });

  describe('?seo=resolved', () => {
    it('leaves SEO fields raw by default (an empty one stays null)', async () => {
      expect(await seoOf(`/api/content/articles/${ids.bare}`)).toBeNull();
    });

    it("fills the defaults in, templating the entry's own title, in the entry's locale", async () => {
      const resolved = await seoOf(`/api/content/articles/${ids.bare}?seo=resolved`);
      expect(resolved).toMatchObject({
        title: 'Hello · Acme',
        description: 'Default description',
        canonical: null,
        noindex: false,
      });
      expect(resolved.image).toMatchObject({ id: image.id, url: image.url });
      // French: its own template, the other texts through the fallback chain.
      const french = await seoOf(`/api/content/articles/${ids.bare}?seo=resolved&locale=fr`);
      expect(french).toMatchObject({ title: 'Bonjour · Acmé', description: 'Default description' });
    });

    it("keeps the entry's own values, its title through the template", async () => {
      const list = expectStatus(
        await read('/api/content/articles?seo=resolved&sort=createdAt:asc'),
        200,
      ).json<{
        data: ArticleBody[];
      }>().data;
      const custom = list.find((entry) => entry.id === ids.custom);
      expect(custom?.seo).toMatchObject({
        title: 'Custom · Acme',
        description: 'Mine',
        canonical: 'https://example.test/c',
        noindex: true,
      });
    });

    it('never falls back to a title field the caller cannot read', async () => {
      const resolved = await seoOf(`/api/content/articles/${ids.bare}?seo=resolved`, titleHiddenToken);
      expect(resolved.title).toBe('Acme');
    });

    it('resolves populated entries too', async () => {
      const body = expectStatus(
        await read(`/api/content/articles/${ids.bare}?seo=resolved&populate=author`),
        200,
      ).json<{ data: ArticleBody }>();
      expect((body.data.author as { seo: Seo }).seo).toMatchObject({ title: 'Ada · Acme', noindex: false });
    });

    it("uses each site's own defaults, never another site's", async () => {
      const resolved = await seoOf(`/api/content/articles/${ids.marketing}?seo=resolved`, marketingToken);
      expect(resolved.title).toBe('Launch | Marketing');
      expect(resolved.description).toBeNull();
      expect(resolved.image).toMatchObject({ id: marketingImage.id });
    });

    it('drops a default image that became private, signed or not', async () => {
      const { db } = database.current;
      await db
        .updateTable('media_assets')
        .set({ visibility: 'private' })
        .where('id', '=', image.id)
        .execute();
      try {
        const resolved = await seoOf(`/api/content/articles/${ids.bare}?seo=resolved`);
        expect(resolved.image).toBeNull();
        const site = expectStatus(await read('/api/site'), 200).json<{ seo: { image: unknown } }>();
        expect(site.seo.image).toBeNull();
      } finally {
        await db
          .updateTable('media_assets')
          .set({ visibility: 'public' })
          .where('id', '=', image.id)
          .execute();
      }
    });

    it('works with a pinned snapshot (with the current defaults)', async () => {
      const { meta } = expectStatus(await read('/api/content/articles'), 200).json<{
        meta: { snapshot: number };
      }>();
      const resolved = await seoOf(
        `/api/content/articles/${ids.bare}?seo=resolved&snapshot=${meta.snapshot}`,
      );
      expect(resolved.title).toBe('Hello · Acme');
    });

    it('is refused where it cannot apply', async () => {
      const noteToken = await siteToken(PRIMARY_SITE_ID, [{ action: 'read', modelId: null }]);
      const onNote = await read('/api/content/notes?seo=resolved', noteToken);
      expect(onNote.statusCode).toBe(400);
      expect((await read('/api/content/articles?seo=everything')).statusCode).toBe(400);
      expect((await adminRequest('GET', '/api/admin/content/article?seo=resolved')).statusCode).toBe(400);
      expect((await read('/api/content/articles?seo=raw')).statusCode).toBe(200);
    });
  });

  describe('GET /api/site', () => {
    it("returns the site's key, name and defaults with the image as a delivered asset", async () => {
      const site = expectStatus(await read('/api/site'), 200).json<{
        key: string;
        name: string;
        seo: { locales: Record<string, unknown>; twitterHandle: string | null; image: { id: string } | null };
      }>();
      expect(site).toMatchObject({
        key: 'default',
        seo: { twitterHandle: '@acme', image: { id: image.id } },
      });
      expect(site.seo.locales.en).toEqual({
        siteName: 'Acme',
        titleTemplate: '%s · Acme',
        description: 'Default description',
      });
      expect(site.seo).not.toHaveProperty('imageId');
      const marketing = expectStatus(await read('/api/site?site=marketing', marketingToken), 200).json<{
        key: string;
      }>();
      expect(marketing.key).toBe('marketing');
    });

    it('is closed to callers that read nothing on the site', async () => {
      expect((await get('/api/site')).statusCode).toBe(401);
      expect((await read('/api/site?site=marketing')).statusCode).toBe(403);
    });
  });
});
