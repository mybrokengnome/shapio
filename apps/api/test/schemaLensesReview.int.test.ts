import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { OLDER_CLIENT_VERSIONS_CAP } from '../src/services/changeSetReviewOlderClients.js';
import { writeUsageBatch } from '../src/services/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  runContentSchemaJobs,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type FieldEffect = { fieldId: string; apiKey: string; effect: string };
type OlderDefinition = {
  definitionId: string;
  apiKey: string;
  status: string;
  effect: string | null;
  oldestVersion: number | null;
  fields: FieldEffect[];
};
type OlderVersion = {
  schemaVersion: number;
  readers: Array<{ principalKey: string; label: string | null; site: { key: string } }> | null;
  readerCount: number;
  otherSites: { consumers: number } | null;
  definitions: OlderDefinition[];
};
type OlderClients = { versions: OlderVersion[]; truncated: boolean };
type Review = {
  schema: Array<{ plan: { changes: Array<{ kind: string }> }; olderClientsEffects: string[] }>;
  olderClients: OlderClients | null;
};
type Preview = {
  plan: { changes: Array<{ kind: string }> };
  olderClientsEffects: string[];
  olderClients: OlderClients;
};

/**
 * Schema lenses in reviews (plan schema-lenses §6, agreed 13): the change set review and the builder's plan
 * preview report, per schema version readers are on, the composite effect of the proposal for them.
 */
describe('schema lenses: older clients in reviews', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let editor: SchemaClient;
  let article: ModelBody;
  let token: string;
  let tokenId: string;
  let tokenName: string;
  /** The schema version the old client was built against, as a token and as a number. */
  let v: string;
  let version: number;

  const read = (query = '') =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/content/articles${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const readAtV = async () => {
    expectStatus(await read(`?schemaVersion=${encodeURIComponent(v)}`), 200);
    await testApp.app.usage.flush();
  };
  const reload = async () =>
    expectStatus(await admin.get(`/api/admin/models/${article.definition.id}`), 200).json<ModelBody>();
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  /** Title renamed, count made text, body removed. */
  const proposalOf = (definition: ModelBody['definition']) => ({
    ...definition,
    fields: definition.fields
      .filter((candidate) => candidate.apiKey !== 'body')
      .map((candidate) => {
        if (candidate.apiKey === 'title') {
          return { ...candidate, apiKey: 'headline' };
        }
        if (candidate.apiKey === 'count') {
          const { editor: _editor, ...rest } = candidate;
          return { ...rest, type: 'string', settings: {} };
        }
        return candidate;
      }),
  });
  const reviewOf = async (client: SchemaClient) => {
    const current = await reload();
    const set = expectStatus(
      await admin.post('/api/admin/change-sets', { title: `Rename ${Math.random()}` }),
      201,
    ).json<{ id: string }>();
    expectStatus(
      await admin.put(`/api/admin/change-sets/${set.id}/schema/${current.definition.id}`, {
        category: 'model',
        definition: proposalOf(current.definition),
        baseVersion: current.version,
      }),
      200,
    );
    return expectStatus(await client.get(`/api/admin/change-sets/${set.id}/review`), 200).json<Review>();
  };
  const atV = (older: OlderClients | null) =>
    older?.versions.find((entry) => entry.schemaVersion === version);

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'count', label: 'Count', type: 'integer' },
        { apiKey: 'summary', label: 'Summary', type: 'text' },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    });
    const roleId = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id },
    ]);
    token = await createTokenForRole(database.current.db, roleId);
    const row = await database.current.db
      .selectFrom('api_tokens')
      .select(['id', 'name'])
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    tokenId = row.id;
    tokenName = row.name;
    expectStatus(
      await admin.post('/api/admin/content/article', {
        data: { title: 'One', count: 3, summary: 'S', body: 'B' },
        publish: true,
      }),
      201,
    );
    v = expectStatus(await read(), 200).headers['shapio-schema-version-current'] as string;
    version = Number(v.split(':')[1]);
    await readAtV();
    // The schema moves on after the client was built: summary is renamed live.
    const current = await reload();
    expectStatus(
      await admin.put(`/api/admin/models/${current.definition.id}`, {
        definition: {
          ...current.definition,
          fields: current.definition.fields.map((candidate) =>
            candidate.apiKey === 'summary' ? { ...candidate, apiKey: 'excerpt' } : candidate,
          ),
        },
        expectedVersion: current.version,
        acknowledgeBreaking: true,
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('records the version a token names and clears it when the token stops naming one', async () => {
    const versions = async () =>
      expectStatus(await admin.get('/api/admin/usage/schema-versions'), 200).json<{
        principals: Array<{ principalKey: string; tokenName?: string; schemaVersion: number }>;
      }>().principals;
    expect(await versions()).toEqual([
      expect.objectContaining({ principalKey: `token:${tokenId}`, tokenName, schemaVersion: version }),
    ]);
    expectStatus(await read(), 200);
    await testApp.app.usage.flush();
    expect(await versions()).toEqual([]);
    await readAtV();
    expect((await versions()).map((entry) => entry.schemaVersion)).toEqual([version]);
    expectStatus(await editor.get('/api/admin/usage/schema-versions'), 403);
  });

  it("counts a read through a version under today's fields, never ones the version does not know", async () => {
    const current = await reload();
    expectStatus(
      await admin.put(`/api/admin/models/${current.definition.id}`, {
        definition: {
          ...current.definition,
          fields: [...current.definition.fields, { apiKey: 'extra', label: 'Extra', type: 'string' }],
        },
        expectedVersion: current.version,
      }),
      200,
    );
    await readAtV();
    const usage = expectStatus(
      await admin.get(`/api/admin/usage/fields?modelId=${article.definition.id}&days=1`),
      200,
    ).json<{ fields: Array<{ apiKeyPath: string | null; principals: Array<{ principalKey: string }> }> }>();
    const readBy = (apiKeyPath: string) =>
      usage.fields
        .find((entry) => entry.apiKeyPath === apiKeyPath)
        ?.principals.some((principal) => principal.principalKey === `token:${tokenId}`) ?? false;
    expect(readBy('excerpt')).toBe(true);
    expect(readBy('title')).toBe(true);
    expect(readBy('extra')).toBe(false);
  });

  it('reports the composite effect for each version tokens send, with the tokens', async () => {
    const review = await reviewOf(admin);
    const olderClients = review.olderClients as OlderClients;
    expect(olderClients.truncated).toBe(false);
    const entry = atV(olderClients);
    expect(entry?.readers).toEqual([
      expect.objectContaining({
        principalKey: `token:${tokenId}`,
        label: tokenName,
        site: expect.objectContaining({ key: expect.any(String) as unknown }) as unknown,
      }),
    ]);
    expect(entry?.readerCount).toBe(1);
    expect(entry?.otherSites).toBeNull();
    const countId = field(article.definition, 'count').id;
    const bodyId = field(article.definition, 'body').id;
    expect(entry?.definitions).toEqual([
      {
        definitionId: article.definition.id,
        apiKey: 'article',
        status: 'available',
        effect: 'nulled',
        oldestVersion: null,
        // The client's names: title and summary were renamed (keep working), so they are not listed.
        fields: [
          {
            fieldId: countId,
            apiKey: 'count',
            effect: 'lossy',
            proposedEffect: 'lossy',
            pastEffect: 'transparent',
            pastSince: null,
          },
          {
            fieldId: bodyId,
            apiKey: 'body',
            effect: 'nulled',
            proposedEffect: 'nulled',
            pastEffect: 'transparent',
            pastSince: null,
          },
        ],
        historyTruncated: false,
      },
    ]);
    const [item] = review.schema;
    expect(item?.olderClientsEffects).toHaveLength(item?.plan.changes.length ?? -1);
    const byKind = new Map(
      item?.plan.changes.map((change, index) => [change.kind, item.olderClientsEffects[index]]),
    );
    expect(byKind.get('field.apiKey')).toBe('transparent');
    expect(byKind.get('field.type')).toBe('lossy');
    expect(byKind.get('field.removed')).toBe('nulled');
  });

  it('shows counts, not token names, to a reviewer without tokens.manage', async () => {
    const entry = atV((await reviewOf(editor)).olderClients);
    expect(entry?.readers).toBeNull();
    expect(entry?.readerCount).toBe(1);
    expect(entry?.definitions[0]?.effect).toBe('nulled');
  });

  it('reports the same in the builder plan preview', async () => {
    const current = await reload();
    const preview = expectStatus(
      await admin.post(`/api/admin/models/${current.definition.id}/plan`, {
        definition: proposalOf(current.definition),
        expectedVersion: current.version,
      }),
      200,
    ).json<Preview>();
    expect(preview.olderClientsEffects).toHaveLength(preview.plan.changes.length);
    const entry = atV(preview.olderClients);
    expect(entry?.readers?.map((reader) => reader.principalKey)).toEqual([`token:${tokenId}`]);
    expect(entry?.definitions[0]?.fields.map((entry) => [entry.apiKey, entry.effect])).toEqual([
      ['count', 'lossy'],
      ['body', 'nulled'],
    ]);
  });

  it('caps the versions it compiles, most recently used first', async () => {
    // More versions to send: each new definition moves the schema version.
    for (let index = 0; index < OLDER_CLIENT_VERSIONS_CAP + 1; index += 1) {
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: `filler${index}`,
        label: `Filler ${index}`,
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
    }
    const latest = Number(
      (expectStatus(await read(), 200).headers['shapio-schema-version-current'] as string).split(':')[1],
    );
    await readAtV();
    const day = usageDayOf(new Date());
    const now = Date.now();
    const sent = Array.from({ length: OLDER_CLIENT_VERSIONS_CAP + 1 }, (_, index) => latest - index);
    await writeUsageBatch(database.current.db, {
      fieldReads: [],
      tokenReads: sent.map((schemaVersion, index) => ({
        day,
        siteId: PRIMARY_SITE_ID,
        principalKey: `anonymous-cap-${index}`,
        requests: 1,
        lastSnapshot: null,
        lastSchemaVersion: schemaVersion,
        // The newest version was used most recently; all after the token's read.
        lastReadAt: new Date(now + (sent.length - index) * 1000),
      })),
    });
    const review = await reviewOf(admin);
    const olderClients = review.olderClients as OlderClients;
    expect(olderClients.truncated).toBe(true);
    expect(olderClients.versions.map((entry) => entry.schemaVersion)).toEqual(
      sent.slice(0, OLDER_CLIENT_VERSIONS_CAP),
    );
    // A version that sends nothing the change touches differently still lists the article as before.
    expect(olderClients.versions[0]?.definitions[0]?.fields.map((entry) => entry.apiKey)).toEqual([
      'count',
      'body',
    ]);
  });

  it('reports a version whose history is missing as unavailable instead of failing', async () => {
    // Back to one version in use: drop the cap test's readers.
    await database.current.db
      .deleteFrom('token_reads')
      .where('principal_key', 'like', 'anonymous-cap-%')
      .execute();
    // History before the rename is lost (as if the audit log had been pruned before 0.9.0).
    const { db } = database.current;
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', article.definition.id)
      .where('schema_version', '<=', version)
      .execute();
    const earliest = await db
      .selectFrom('schema_activations')
      .select((eb) => eb.fn.min('schema_version').as('schema_version'))
      .where('model_id', '=', article.definition.id)
      .executeTakeFirstOrThrow();
    const oldest = Number(earliest.schema_version);
    await db
      .updateTable('schema_activations')
      .set({ backfilled: true })
      .where('model_id', '=', article.definition.id)
      .where('schema_version', '=', oldest)
      .execute();
    clearLensCaches();
    const entry = atV((await reviewOf(admin)).olderClients);
    expect(entry?.definitions).toEqual([
      expect.objectContaining({
        definitionId: article.definition.id,
        status: 'unavailable',
        effect: null,
        oldestVersion: oldest,
        fields: [],
      }),
    ]);
  });
});
