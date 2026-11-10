import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { OLDER_CLIENT_VERSIONS_CAP } from '../src/services/changeSetReviewOlderClients.js';
import { writeUsageBatch } from '../src/services/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import {
  createDefinition,
  createRole,
  expectStatus,
  runContentSchemaJobs,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Reader = { principalKey: string; pinned: boolean; network: boolean; lastReadAt: string | null };
type OlderField = { apiKey: string; effect: string; pastEffect: string; pastSince: number | null };
type OlderVersion = {
  schemaVersion: number;
  readers: Reader[] | null;
  definitions: Array<{ definitionId: string; fields: OlderField[] }>;
};
type Review = { olderClients: { versions: OlderVersion[]; truncated: boolean } | null };
type Definition = ModelBody['definition'];
type Field = Definition['fields'][number];

/**
 * Who the review lists on which schema version, and what inherited fields lost (plan schema-lenses): pinned
 * versions are kept ahead of versions merely read from, a re-pinned token is on its new pin only, an unread
 * pinned network token is listed, and a parent's steps count for the fields a kind inherits.
 */
describe('schema lenses: readers and inherited fields in the review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;
  let article: ModelBody;
  let readRole: string;

  const versionOf = (header: unknown) => Number(String(header).split(':')[1]);
  const currentVersion = async () =>
    versionOf(
      expectStatus(await admin.get('/api/content/articles'), 200).headers['shapio-schema-version-current'],
    );
  const reload = async (model: ModelBody) =>
    expectStatus(await admin.get(`/api/admin/models/${model.definition.id}`), 200).json<ModelBody>();
  const createToken = async (body: Record<string, unknown>) =>
    expectStatus(
      await admin.post('/api/admin/tokens', { name: `Token ${Math.random()}`, ...body }),
      201,
    ).json<{ token: string; apiToken: { id: string } }>();
  const setPin = async (id: string, pinnedSchemaVersion: number) =>
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/tokens/${id}`,
        payload: { pinnedSchemaVersion },
      }),
      200,
    );
  const withField = (definition: Definition, apiKey: string, patch: (field: Field) => Field) => ({
    ...definition,
    fields: definition.fields.map((field) => (field.apiKey === apiKey ? patch(field) : field)),
  });
  const changeLive = async (
    model: ModelBody,
    update: (definition: Definition) => Record<string, unknown>,
  ) => {
    const current = await reload(model);
    const response = await admin.put(`/api/admin/models/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], response.body).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
  };
  /** The change set review of a label change to `model`. */
  const reviewOf = async (model: ModelBody) => {
    const current = await reload(model);
    const set = expectStatus(
      await admin.post('/api/admin/change-sets', { title: `Review ${Math.random()}` }),
      201,
    ).json<{ id: string }>();
    expectStatus(
      await admin.put(`/api/admin/change-sets/${set.id}/schema/${current.definition.id}`, {
        category: 'model',
        definition: { ...current.definition, label: `${String(current.definition.label)}!` },
        baseVersion: current.version,
      }),
      200,
    );
    return expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/review`), 200).json<Review>()
      .olderClients;
  };
  const versionsOf = (review: Review['olderClients'], principalKey: string) =>
    (review?.versions ?? []).flatMap((entry) =>
      (entry.readers ?? []).some((reader) => reader.principalKey === principalKey)
        ? [entry.schemaVersion]
        : [],
    );

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    readRole = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists a re-pinned token at its current pin only, not where it read before', async () => {
    const first = await currentVersion();
    const { token, apiToken } = await createToken({ roleId: readRole, pinnedSchemaVersion: first });
    expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: '/api/content/articles',
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    );
    await testApp.app.usage.flush();
    await changeLive(article, (current) =>
      withField(current, 'title', (field) => ({ ...field, label: 'Heading' })),
    );
    const second = await currentVersion();
    await setPin(apiToken.id, second);
    const review = await reviewOf(article);
    expect(versionsOf(review, `token:${apiToken.id}`)).toEqual([second]);
    const reader = review?.versions
      .find((entry) => entry.schemaVersion === second)
      ?.readers?.find((entry) => entry.principalKey === `token:${apiToken.id}`);
    expect(reader).toMatchObject({ pinned: true, network: false, lastReadAt: null });
  });

  it('lists a pinned network token that has not read, labelled as one', async () => {
    const [adminRole] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
    const pin = await currentVersion();
    const { apiToken } = await createToken({
      roleId: adminRole?.id,
      network: true,
      pinnedSchemaVersion: pin,
    });
    const review = await reviewOf(article);
    const reader = review?.versions
      .find((entry) => entry.schemaVersion === pin)
      ?.readers?.find((entry) => entry.principalKey === `token:${apiToken.id}`);
    expect(reader).toMatchObject({ pinned: true, network: true, lastReadAt: null });
  });

  it('keeps pinned versions ahead of versions merely read from, up to the cap', async () => {
    const pinned = await currentVersion();
    const { apiToken } = await createToken({ roleId: readRole, pinnedSchemaVersion: pinned });
    // More versions read from, and read from more recently, than the cap holds.
    for (let index = 0; index < OLDER_CLIENT_VERSIONS_CAP + 1; index += 1) {
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: `filler${index}`,
        label: `Filler ${index}`,
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
    }
    const latest = await currentVersion();
    const now = Date.now();
    await writeUsageBatch(database.current.db, {
      fieldReads: [],
      tokenReads: Array.from({ length: OLDER_CLIENT_VERSIONS_CAP + 1 }, (_, index) => ({
        day: usageDayOf(new Date()),
        siteId: PRIMARY_SITE_ID,
        principalKey: `anonymous-cap-${index}`,
        requests: 1,
        lastSnapshot: null,
        lastSchemaVersion: latest - index,
        lastReadAt: new Date(now - index * 1000),
      })),
    });
    const review = await reviewOf(article);
    expect(review?.truncated).toBe(true);
    expect(review?.versions).toHaveLength(OLDER_CLIENT_VERSIONS_CAP);
    expect(versionsOf(review, `token:${apiToken.id}`)).toEqual([pinned]);
    await database.current.db
      .deleteFrom('token_reads')
      .where('principal_key', 'like', 'anonymous-cap-%')
      .execute();
  });

  it('reports what a parent’s steps did to the fields a kind inherits', async () => {
    const many = { target: author.definition.id, cardinality: 'many' };
    const post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      pluralApiKey: 'posts',
      label: 'Post',
      fields: [
        { apiKey: 'heading', label: 'Heading', type: 'string' },
        { apiKey: 'links', label: 'Links', type: 'relation', settings: many },
      ],
    });
    const guide = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'guide',
      pluralApiKey: 'guides',
      label: 'Guide',
      extends: post.definition.id,
      fields: [{ apiKey: 'level', label: 'Level', type: 'string' }],
    });
    const version = await currentVersion();
    const role = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: guide.definition.id },
    ]);
    const { apiToken } = await createToken({ roleId: role, pinnedSchemaVersion: version });
    // The parent's list is cut to its first item, then made a list again.
    await changeLive(post, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: { ...many, cardinality: 'one' } })),
    );
    const cutAt = await currentVersion();
    await changeLive(post, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: many })),
    );
    const review = await reviewOf(guide);
    const entry = review?.versions.find((candidate) => candidate.schemaVersion === version);
    expect(versionsOf(review, `token:${apiToken.id}`)).toEqual([version]);
    const links = entry?.definitions
      .find((definition) => definition.definitionId === guide.definition.id)
      ?.fields.find((field) => field.apiKey === 'links');
    expect(links).toMatchObject({ effect: 'lossy', pastEffect: 'lossy', pastSince: cutAt });
  });
});
