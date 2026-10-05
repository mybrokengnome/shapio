import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, createDeliveryToken, expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type SiteData = {
  _site: {
    key: string;
    name: string;
    seo: {
      twitterHandle: string | null;
      image: { id: string; url: string } | null;
      locales: Array<{
        locale: string;
        siteName: string | null;
        titleTemplate: string | null;
        description: string | null;
      }>;
    };
  };
};

const SITE_QUERY = `{
  _site {
    key
    name
    seo {
      twitterHandle
      image { id url }
      locales { locale siteName titleTemplate description }
    }
  }
}`;

/** GraphQL's `_site` root field (plan seo-fields): the site and its SEO defaults, like `GET /api/site`. */
describe('GraphQL _site field', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let image: MediaAssetBody;
  let token: string;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    const adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    image = await uploadAsset(
      testApp.app,
      { authorization: `Bearer ${adminToken}` },
      { file: await createPng(16, 16), filename: 'og.png', mimeType: 'image/png' },
    );
    const page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    token = await createDeliveryToken(database.current.db, [{ modelId: page.definition.id }]);
    const current = expectStatus(await admin.get('/api/admin/site/seo'), 200).json<{ version: number }>();
    expectStatus(
      await admin.put('/api/admin/site/seo', {
        expectedVersion: current.version,
        seo: {
          locales: { en: { siteName: 'Acme', titleTemplate: '%s · Acme' } },
          imageId: image.id,
          twitterHandle: '@acme',
        },
      }),
      200,
    );
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it("returns the request's site and its defaults, the image as a delivered asset", async () => {
    const result = await graphql<SiteData>(testApp.app, SITE_QUERY, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data?._site).toEqual({
      key: 'default',
      name: expect.any(String) as string,
      seo: {
        twitterHandle: '@acme',
        image: { id: image.id, url: image.url },
        locales: [{ locale: 'en', siteName: 'Acme', titleTemplate: '%s · Acme', description: null }],
      },
    });
  });

  it('is closed to callers that read nothing on the site', async () => {
    const result = await graphql<SiteData>(testApp.app, SITE_QUERY);
    expect(result.body.data?._site ?? null).toBeNull();
    expect(result.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
