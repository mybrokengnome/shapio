import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliIo } from '@shapio/cli';
import { REMOTE_COMMANDS } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import { createContentPorts } from '../src/content/ports.js';
import { createTransferJobHandlers } from '../src/content/transfer/job.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createMediaJobHandlers } from '../src/media/jobs.js';
import { createSchemaJobHandlers } from '../src/schema/planner/changeJob.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createPng, runMediaJobs, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

const PUBLIC_URL = 'http://cms.test';

/** Everything a test needs from one running instance. */
type Instance = {
  database: TestDatabase;
  testApp: TestApp;
  url: string;
  adminToken: string;
  mediaPath: string;
};

const startInstance = async (database: TestDatabase): Promise<Instance> => {
  const mediaPath = await mkdtemp(join(tmpdir(), 'shapio-transfer-media-'));
  const testApp = await createTestApp(database, {
    schemaListen: false,
    env: { ...GRAPHQL_ENV, MEDIA_PATH: mediaPath, PUBLIC_URL },
  });
  await testApp.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = testApp.app.server.address() as AddressInfo;
  return {
    database,
    testApp,
    url: `http://127.0.0.1:${port}`,
    adminToken: await createRoleToken(database.db),
    mediaPath,
  };
};

const stopInstance = async (instance: Instance | undefined) => {
  await instance?.testApp.app.close();
  await instance?.database.drop();
  if (instance) {
    await rm(instance.mediaPath, { recursive: true, force: true });
  }
};

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: {} };
  return { io, out: () => out.join(''), err: () => err.join('') };
};

const runCli = async (name: 'export' | 'import', args: string[]) => {
  const output = capture();
  const command = REMOTE_COMMANDS[name];
  if (!command) {
    throw new Error(`No ${name} command`);
  }
  const code = await command.run(args, output.io);
  return { code, stdout: output.out(), stderr: output.err() };
};

/** A worker with the handlers an import needs (the transfer job itself, media variants, schema changes). */
const startWorker = (instance: Instance): Worker => {
  const { db } = instance.database;
  const worker = createWorker({
    db,
    handlers: createJobHandlers([
      ...createTransferJobHandlers({ db, storage: instance.testApp.app.mediaStorage }),
      ...createMediaJobHandlers({ db, storage: instance.testApp.app.mediaStorage }),
      ...createSchemaJobHandlers({ db, ports: createContentPorts(db) }),
    ]),
    workerId: `test-${randomUUID()}`,
    concurrency: 2,
    pollIntervalMs: 50,
    leaseMs: 30_000,
    log: silentLogger,
  });
  worker.start();
  return worker;
};

type Seeded = {
  authorId: string;
  author: ModelBody;
  article: ModelBody;
  image: MediaAssetBody;
  published: EntryBody;
  draftOnly: EntryBody;
};

/** Authors and localized articles with a relation, rich text with an image, media, drafts and published heads. */
const seed = async (instance: Instance): Promise<Seeded> => {
  const admin = schemaClient(instance.testApp.app, instance.adminToken);
  const headers = { authorization: `Bearer ${instance.adminToken}` };
  expectStatus(
    await admin.post('/api/admin/locales', { code: 'fr', label: 'Français', fallbacks: ['en'] }),
    201,
  );
  const author = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'author',
    label: 'Author',
    fields: [
      { apiKey: 'name', label: 'Name', type: 'string', required: true },
      { apiKey: 'handle', label: 'Handle', type: 'slug', unique: true },
    ],
  });
  const article = await createDefinition(admin, {
    kind: 'collection',
    apiKey: 'article',
    label: 'Article',
    localized: true,
    fields: [
      { apiKey: 'title', label: 'Title', type: 'string', required: true, localized: true },
      { apiKey: 'body', label: 'Body', type: 'richtext', localized: true },
      { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      {
        apiKey: 'author',
        label: 'Author',
        type: 'relation',
        settings: { target: author.definition.id, cardinality: 'one' },
      },
    ],
  });
  const image = await uploadAsset(instance.testApp.app, headers, {
    file: await createPng(640, 360),
    filename: 'Cover image.png',
    mimeType: 'image/png',
  });
  await runMediaJobs(instance.testApp.app, instance.database.db);
  const ada = expectStatus(
    await admin.post('/api/admin/content/author', { data: { name: 'Ada', handle: 'ada' }, publish: true }),
    201,
  ).json<EntryBody>();
  const body = (text: string) => ({
    format: 'shapio-richtext',
    version: 1,
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text }] },
        { type: 'image', attrs: { mediaId: image.id, alt: 'Cover' } },
      ],
    },
  });
  const created = expectStatus(
    await admin.post('/api/admin/content/article', {
      locale: 'en',
      data: { title: 'Hello', body: body('English body'), cover: image.id, author: ada.id },
    }),
    201,
  ).json<EntryBody>();
  expectStatus(
    await admin.put(`/api/admin/content/article/${created.id}`, {
      locale: 'fr',
      expectedVersion: null,
      data: { title: 'Bonjour', body: body('Corps français') },
    }),
    200,
  );
  const published = expectStatus(
    await admin.post(`/api/admin/content/article/${created.id}/publish`, { locales: ['en', 'fr'] }),
    200,
  ).json<EntryBody>();
  // A newer draft on top of the published English version, and an entry that was never published.
  expectStatus(
    await admin.put(`/api/admin/content/article/${created.id}`, {
      locale: 'en',
      expectedVersion: published.version,
      data: { title: 'Hello (draft edit)' },
    }),
    200,
  );
  const draftOnly = expectStatus(
    await admin.post('/api/admin/content/article', { locale: 'en', data: { title: 'Unpublished' } }),
    201,
  ).json<EntryBody>();
  return { authorId: ada.id, author, article, image, published, draftOnly };
};

const ARTICLE_QUERY = `query ($locale: String) {
  articles(locale: $locale) {
    nodes {
      id locale createdAt updatedAt publishedAt title
      body { json html }
      cover { id filename url width height variants { name width url } }
      author { id name handle }
    }
    totalCount
  }
}`;

/** Delivery responses that must survive the round trip unchanged (the snapshot number restarts on a new instance). */
const deliveryResponses = async (instance: Instance, models: Seeded) => {
  const token = await createDeliveryToken(instance.database.db, [{ modelId: null }]);
  const headers = { authorization: `Bearer ${token}` };
  const rest = async (url: string) => {
    const body = expectStatus(await instance.testApp.app.inject({ method: 'GET', url, headers }), 200).json<{
      meta: Record<string, unknown>;
    }>();
    delete body.meta.snapshot;
    return body;
  };
  const gql = async (locale: string) =>
    dataOf(await graphql(instance.testApp.app, ARTICLE_QUERY, { variables: { locale }, headers }));
  return {
    articlesEn: await rest('/api/content/articles?locale=en&populate=author'),
    articlesFr: await rest('/api/content/articles?locale=fr&populate=author'),
    oneArticle: await rest(`/api/content/articles/${models.published.id}?locale=fr&populate=author`),
    authors: await rest('/api/content/authors'),
    graphqlEn: await gql('en'),
    graphqlFr: await gql('fr'),
  };
};

const schemaExport = async (instance: Instance) => {
  const admin = schemaClient(instance.testApp.app, instance.adminToken);
  const exported = expectStatus(await admin.get('/api/admin/schema/export'), 200).json<{
    definitions: Array<{ definition: { id: string }; hash: string }>;
  }>();
  return exported.definitions
    .map(({ definition, hash }) => ({ definition, hash }))
    .sort((a, b) => a.definition.id.localeCompare(b.definition.id));
};

const sha256File = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

describe('content export and import (shapio export / shapio import)', () => {
  let source: Instance | undefined;
  let target: Instance | undefined;
  let worker: Worker | undefined;
  let workdir: string;
  let seeded: Seeded;
  let before: Awaited<ReturnType<typeof deliveryResponses>>;
  let schemaBefore: Awaited<ReturnType<typeof schemaExport>>;
  let bundle: string;
  let archive: string;
  /** Exported after a later edit on the source: the target is then behind it (fast-forward). */
  let newer: string;
  let sourceChecksum: string | null;
  /** The source's delivery roles (key → grants) and its token hashes, which must never travel. */
  let sourceDeliveryRoles: string[];
  let sourceTokenHashes: string[];

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-transfer-'));
    bundle = join(workdir, 'content.ndjson');
    archive = join(workdir, 'content.tar');
    newer = join(workdir, 'newer.ndjson');
    // Instances run one after the other: repositories share one process-wide database handle.
    source = await startInstance(await createTestDatabase());
    seeded = await seed(source);
    before = await deliveryResponses(source, seeded);
    schemaBefore = await schemaExport(source);
    sourceChecksum = (
      await source.database.db
        .selectFrom('media_assets')
        .select('checksum_sha256')
        .where('id', '=', seeded.image.id)
        .executeTakeFirstOrThrow()
    ).checksum_sha256;
    sourceDeliveryRoles = (
      await source.database.db
        .selectFrom('admin_roles')
        .select('key')
        .where('kind', '=', 'delivery')
        .execute()
    ).map((row) => row.key);
    sourceTokenHashes = (
      await source.database.db.selectFrom('api_tokens').select('token_hash').execute()
    ).map((row) => row.token_hash);
    const auth = ['--url', source.url, '--token', source.adminToken];
    const plain = await runCli('export', [...auth, bundle]);
    expect(plain, plain.stderr).toMatchObject({ code: 0 });
    const withMedia = await runCli('export', [...auth, '--with-media', archive]);
    expect(withMedia, withMedia.stderr).toMatchObject({ code: 0 });
    const admin = schemaClient(source.testApp.app, source.adminToken);
    const ada = expectStatus(
      await admin.get(`/api/admin/content/author/${seeded.authorId}`),
      200,
    ).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/author/${seeded.authorId}`, {
        expectedVersion: ada.version,
        data: { name: 'Ada Lovelace' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/author/${seeded.authorId}/publish`, {}), 200);
    expect(await runCli('export', [...auth, newer])).toMatchObject({ code: 0 });
    await stopInstance(source);
    source = undefined;
    target = await startInstance(await createTestDatabase());
    worker = startWorker(target);
  });

  afterAll(async () => {
    await worker?.stop(5000);
    await stopInstance(source);
    await stopInstance(target);
    await rm(workdir, { recursive: true, force: true });
  });

  it('writes an NDJSON bundle with a header, the schema, entries with history and an end record', async () => {
    const lines = (await readFile(bundle, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
    expect(lines[0]).toMatchObject({ type: 'header', format: 'shapio-export', formatVersion: 1 });
    expect(lines.at(-1)).toMatchObject({
      type: 'end',
      counts: { entry: 3, mediaAsset: 1, definition: 2, locale: 2 },
    });
    const article = lines.find(
      (line) => line.type === 'entry' && line.id === seeded.published.id,
    ) as unknown as {
      revisions: unknown[];
      heads: Array<{ locale: string; state: string }>;
    };
    expect(article.heads.map((head) => `${head.locale}:${head.state}`).sort()).toEqual([
      'en:draft',
      'en:published',
      'fr:draft',
      'fr:published',
    ]);
    expect(article.revisions.length).toBeGreaterThan(2);
    // Secrets never travel; no app users without --include-users.
    expect(lines.some((line) => line.type === 'appUser')).toBe(false);
  });

  it('plans an import into an empty instance as all additions (dry run, nothing written)', async () => {
    const instance = target as Instance;
    const result = await runCli('import', [
      '--url',
      instance.url,
      '--token',
      instance.adminToken,
      '--dry-run',
      archive,
    ]);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Locales: 1 added (fr)');
    expect(result.stdout).toContain('Delivery roles: 1 added');
    expect(result.stdout).toContain('Models and components: 2 added');
    expect(result.stdout).toContain('Entries: 3 added, 0 updated, 0 unchanged, 0 conflicting');
    expect(result.stdout).toContain('No conflicts.');
    const entries = await instance.database.db.selectFrom('entries').select('id').execute();
    expect(entries).toEqual([]);
  });

  it('imports into a fresh database: identical schema, REST and GraphQL delivery, media checksums', async () => {
    const instance = target as Instance;
    const result = await runCli('import', ['--url', instance.url, '--token', instance.adminToken, archive]);
    expect(result, `${result.stdout}\n${result.stderr}`).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Uploaded 1 media file(s).');
    await runMediaJobs(instance.testApp.app, instance.database.db);

    // The comparison is meaningful: published content in both locales, populated, with media variants.
    expect(before.articlesFr).toMatchObject({
      data: [{ title: 'Bonjour', author: { name: 'Ada' }, cover: { id: seeded.image.id } }],
    });
    expect(
      (before.articlesEn as unknown as { data: Array<{ cover: { variants: unknown[] } }> }).data[0]?.cover
        .variants.length,
    ).toBeGreaterThan(0);
    expect(before.graphqlEn).toMatchObject({
      articles: { totalCount: 1, nodes: [{ title: 'Hello' }] },
    });
    expect(schemaBefore).toHaveLength(2);

    expect(await schemaExport(instance)).toEqual(schemaBefore);
    expect(await deliveryResponses(instance, seeded)).toEqual(before);

    const asset = await instance.database.db
      .selectFrom('media_assets')
      .select(['storage_key', 'checksum_sha256', 'status'])
      .where('id', '=', seeded.image.id)
      .executeTakeFirstOrThrow();
    expect(asset).toMatchObject({ checksum_sha256: sourceChecksum, status: 'ready' });
    expect(await sha256File(join(instance.mediaPath, asset.storage_key))).toBe(sourceChecksum);

    // Delivery roles came along with their grants; no API token did.
    expect(sourceDeliveryRoles.length).toBeGreaterThan(0);
    const roles = await instance.database.db
      .selectFrom('admin_roles')
      .select(['key', 'kind'])
      .where('key', 'in', sourceDeliveryRoles)
      .execute();
    expect(roles.map((role) => role.kind)).toEqual(sourceDeliveryRoles.map(() => 'delivery'));
    const tokens = await instance.database.db.selectFrom('api_tokens').select('token_hash').execute();
    expect(tokens.filter((token) => sourceTokenHashes.includes(token.token_hash))).toEqual([]);
    expect(await readFile(bundle, 'utf8')).not.toContain('shp_');

    // History and drafts came along: the draft edit is there, unpublished.
    const admin = schemaClient(instance.testApp.app, instance.adminToken);
    const draft = expectStatus(
      await admin.get(`/api/admin/content/article/${seeded.published.id}?locale=en`),
      200,
    ).json<EntryBody>();
    expect(draft).toMatchObject({ status: 'modified', data: { title: 'Hello (draft edit)' } });
    expectStatus(await admin.get(`/api/admin/content/article/${seeded.draftOnly.id}?locale=en`), 200);
  });

  it('re-imports idempotently: everything unchanged', async () => {
    const instance = target as Instance;
    const result = await runCli('import', ['--url', instance.url, '--token', instance.adminToken, bundle]);
    expect(result, `${result.stdout}\n${result.stderr}`).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Entries: 0 added, 0 updated, 3 unchanged, 0 conflicting');
    expect(result.stdout).toContain('Models and components: 0 added');
    expect(await deliveryResponses(instance, seeded)).toEqual(before);
  });

  it('fast-forwards entries the target has not changed since: updated, then identical to the newer source', async () => {
    const instance = target as Instance;
    const auth = ['--url', instance.url, '--token', instance.adminToken];
    const planned = await runCli('import', [...auth, '--dry-run', newer]);
    expect(planned, planned.stderr).toMatchObject({ code: 0 });
    expect(planned.stdout).toContain('Entries: 0 added, 1 updated, 2 unchanged, 0 conflicting');
    expect(planned.stdout).toContain('author: 0 added, 1 updated, 0 unchanged, 0 conflicting');
    const imported = await runCli('import', [...auth, newer]);
    expect(imported, `${imported.stdout}\n${imported.stderr}`).toMatchObject({ code: 0 });
    const delivered = expectStatus(
      await instance.testApp.app.inject({
        method: 'GET',
        url: `/api/content/articles/${seeded.published.id}?populate=author`,
        headers: { authorization: `Bearer ${instance.adminToken}` },
      }),
      200,
    ).json<{ data: { author: { name: string } } }>();
    expect(delivered.data.author.name).toBe('Ada Lovelace');
  });

  it('reports target edits as conflicts and refuses; --prune counts entries the bundle lacks', async () => {
    const instance = target as Instance;
    const admin = schemaClient(instance.testApp.app, instance.adminToken);
    const current = expectStatus(
      await admin.get(`/api/admin/content/article/${seeded.draftOnly.id}?locale=en`),
      200,
    ).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/article/${seeded.draftOnly.id}`, {
        locale: 'en',
        expectedVersion: current.version,
        data: { title: 'Edited on the target' },
      }),
      200,
    );
    const extra = expectStatus(
      await admin.post('/api/admin/content/author', { data: { name: 'Grace', handle: 'grace' } }),
      201,
    ).json<EntryBody>();

    // A model the target changed is a conflict too: an import never changes an existing model.
    const author = expectStatus(
      await admin.get(`/api/admin/models/${seeded.author.definition.id}`),
      200,
    ).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${seeded.author.definition.id}`, {
        definition: { ...author.definition, description: 'Changed on the target' },
        expectedVersion: author.version,
      }),
      200,
    );

    const auth = ['--url', instance.url, '--token', instance.adminToken];
    const dryRun = await runCli('import', [...auth, '--dry-run', '--prune', bundle]);
    expect(dryRun.code).toBe(1);
    expect(dryRun.stdout).toContain('Models and components: 0 added, 1 unchanged, 1 conflicting');
    expect(dryRun.stdout).toContain('! collection author: the target has it in another form');
    expect(dryRun.stdout).toContain(`! entry ${seeded.draftOnly.id} (article): changedOnTarget`);
    expect(dryRun.stdout).toContain('Prune: 1 target entries not in the bundle would be deleted');

    const refused = await runCli('import', [...auth, bundle]);
    expect(refused.code).toBe(1);
    // Schema, the edited draft, and the author: the target moved past this older bundle (fast-forward above).
    expect(refused.stdout).toContain('3 conflict(s): the import would be refused');
    const stillEdited = expectStatus(
      await admin.get(`/api/admin/content/article/${seeded.draftOnly.id}?locale=en`),
      200,
    ).json<EntryBody>();
    expect(stillEdited.data.title).toBe('Edited on the target');
    expectStatus(await admin.get(`/api/admin/content/author/${extra.id}`), 200);
  });

  it('refuses a truncated bundle and a bundle file that is not a bundle', async () => {
    const instance = target as Instance;
    const truncated = join(workdir, 'truncated.ndjson');
    const text = await readFile(bundle, 'utf8');
    await writeFile(truncated, text.split('\n').slice(0, 4).join('\n'));
    const result = await runCli('import', [
      '--url',
      instance.url,
      '--token',
      instance.adminToken,
      '--dry-run',
      truncated,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('truncated');
  });

  it('requires an owner or admin', async () => {
    const instance = target as Instance;
    const editor = await createRoleToken(instance.database.db, 'editor');
    const response = await instance.testApp.app.inject({
      method: 'GET',
      url: '/api/admin/transfer/export',
      headers: { authorization: `Bearer ${editor}` },
    });
    expect(response.statusCode).toBe(403);
    const anonymous = await instance.testApp.app.inject({ method: 'GET', url: '/api/admin/transfer/export' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('export and import of one site’s schema (plan site-schema)', () => {
  let source: Instance | undefined;
  let target: Instance | undefined;
  let worker: Worker | undefined;
  let workdir: string;

  type ListBody = { items: Array<{ definition: { apiKey: string }; scope: string; siteId: string | null }> };
  const scopesOn = async (instance: Instance, siteKey: string) =>
    (
      await instance.testApp.app.inject({
        method: 'GET',
        url: '/api/admin/models',
        headers: { authorization: `Bearer ${instance.adminToken}`, [SITE_HEADER]: siteKey },
      })
    )
      .json<ListBody>()
      .items.map((item) => `${item.definition.apiKey}:${item.scope}:${item.siteId ?? 'shared'}`)
      .sort();

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-transfer-sites-'));
  });

  afterAll(async () => {
    await worker?.stop(5000);
    await stopInstance(source);
    await stopInstance(target);
    await rm(workdir, { recursive: true, force: true });
  });

  it('recreates the site’s own definitions on the target site and shared ones shared', async () => {
    const bundle = join(workdir, 'site.ndjson');
    // Instances run one after the other: repositories share one process-wide database handle.
    source = await startInstance(await createTestDatabase());
    const sourceAdmin = schemaClient(source.testApp.app, source.adminToken);
    await createDefinition(sourceAdmin, {
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    await createDefinition(
      sourceAdmin,
      {
        kind: 'collection',
        apiKey: 'label',
        label: 'Label',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      },
      'models',
      'network',
    );
    // An entry of the shared model, so the bundle covers it and a prune considers it.
    expectStatus(await sourceAdmin.post('/api/admin/content/label', { data: { name: 'From source' } }), 201);
    const exported = await runCli('export', [
      '--url',
      source.url,
      '--token',
      source.adminToken,
      '--site',
      'default',
      bundle,
    ]);
    expect(exported, exported.stderr).toMatchObject({ code: 0 });
    await stopInstance(source);
    source = undefined;

    target = await startInstance(await createTestDatabase());
    worker = startWorker(target);
    const site = await target.testApp.app.inject({
      method: 'POST',
      url: '/api/admin/sites',
      headers: { authorization: `Bearer ${target.adminToken}` },
      payload: { key: 'blog', name: 'Blog' },
    });
    const blogId = expectStatus(site, 201).json<{ id: string }>().id;
    const imported = await runCli('import', [
      '--url',
      target.url,
      '--token',
      target.adminToken,
      '--site',
      'blog',
      bundle,
    ]);
    expect(imported, `${imported.stdout}\n${imported.stderr}`).toMatchObject({ code: 0 });
    expect(await scopesOn(target, 'blog')).toEqual(['label:network:shared', `story:site:${blogId}`]);
    expect(await scopesOn(target, 'default')).toEqual(['label:network:shared']);
  });

  it('prunes on the target site only: another site’s entries of a shared model stay untouched', async () => {
    const instance = target as Instance;
    const bundle = join(workdir, 'site.ndjson');
    const onDefault = await instance.testApp.app.inject({
      method: 'POST',
      url: '/api/admin/content/label',
      headers: { authorization: `Bearer ${instance.adminToken}`, [SITE_HEADER]: 'default' },
      payload: { data: { name: 'Only on the default site' } },
    });
    const kept = expectStatus(onDefault, 201).json<EntryBody>();
    const args = ['--url', instance.url, '--token', instance.adminToken, '--site', 'blog'];
    const planned = await runCli('import', [...args, '--dry-run', '--prune', bundle]);
    expect(planned, planned.stderr).toMatchObject({ code: 0 });
    expect(planned.stdout).toContain('Prune: 0 target entries');
    const pruned = await runCli('import', [...args, '--prune', bundle]);
    expect(pruned, `${pruned.stdout}\n${pruned.stderr}`).toMatchObject({ code: 0, stderr: '' });
    expect(pruned.stdout).toContain('pruned entries: 0');
    const live = await instance.database.db
      .selectFrom('entries')
      .select(['id', 'deleted_at'])
      .where('id', '=', kept.id)
      .executeTakeFirstOrThrow();
    expect(live.deleted_at).toBeNull();
  });
});

describe('roles in one site’s bundle (roles are instance-wide, models belong to sites)', () => {
  let source: Instance | undefined;
  let target: Instance | undefined;
  let worker: Worker | undefined;
  let workdir: string;

  type BundleLine = { type: string; key?: string; permissions?: Array<{ modelId: string | null }> };
  const deliveryRoleModels = (lines: BundleLine[]): Record<string, Array<string | null>> =>
    Object.fromEntries(
      lines
        .filter((line) => line.type === 'deliveryRole')
        .map((line): [string, Array<string | null>] => [
          line.key ?? '',
          (line.permissions ?? []).map((grant) => grant.modelId),
        ]),
    );

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-transfer-roles-'));
  });

  afterAll(async () => {
    await worker?.stop(5000);
    await stopInstance(source);
    await stopInstance(target);
    await rm(workdir, { recursive: true, force: true });
  });

  it('exports each role with its grants on the bundle’s models only; an older bundle still imports', async () => {
    const bundle = join(workdir, 'default.ndjson');
    source = await startInstance(await createTestDatabase());
    const admin = schemaClient(source.testApp.app, source.adminToken);
    const story = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    expectStatus(await admin.post('/api/admin/sites', { key: 'other', name: 'Other' }), 201);
    const onOther: SchemaClient = {
      ...admin,
      get: (url) => admin.request({ method: 'GET', url, headers: { [SITE_HEADER]: 'other' } }),
      post: (url, payload) =>
        admin.request({
          method: 'POST',
          url,
          payload: payload as object,
          headers: { [SITE_HEADER]: 'other' },
        }),
    };
    const secret = await createDefinition(onOther, {
      kind: 'collection',
      apiKey: 'secret',
      label: 'Secret',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const readGrants = (modelIds: string[]) =>
      modelIds.map((modelId) => ({ action: 'read', modelId, condition: null, fieldIds: null }));
    for (const [key, modelIds] of [
      ['mixed', [story.definition.id, secret.definition.id]],
      ['other-only', [secret.definition.id]],
    ] as const) {
      const created = await admin.post('/api/admin/roles', {
        key,
        name: key,
        kind: 'delivery',
        permissions: readGrants([...modelIds]),
      });
      expectStatus(created, 201);
    }
    const exported = await runCli('export', [
      '--url',
      source.url,
      '--token',
      source.adminToken,
      '--site',
      'default',
      bundle,
    ]);
    expect(exported, exported.stderr).toMatchObject({ code: 0 });
    // Importing the bundle back leaves the role's grant on the other site's model alone.
    const sourceWorker = startWorker(source);
    const reimported = await runCli('import', [
      '--url',
      source.url,
      '--token',
      source.adminToken,
      '--site',
      'default',
      bundle,
    ]);
    await sourceWorker.stop(5000);
    expect(reimported, `${reimported.stdout}\n${reimported.stderr}`).toMatchObject({ code: 0 });
    const mixedGrants = await source.database.db
      .selectFrom('admin_role_permissions as grant')
      .innerJoin('admin_roles as role', 'role.id', 'grant.role_id')
      .select('grant.model_id')
      .where('role.key', '=', 'mixed')
      .execute();
    expect(mixedGrants.map((grant) => grant.model_id).sort()).toEqual(
      [story.definition.id, secret.definition.id].sort(),
    );
    await stopInstance(source);
    source = undefined;

    const lines = (await readFile(bundle, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BundleLine);
    // The other site's model never leaves, so neither does a grant on it, nor a role that only had those.
    expect(deliveryRoleModels(lines)).toEqual({ mixed: [story.definition.id] });

    // A bundle written before that fix: it carries a role whose grants name a model the target lacks.
    const older = join(workdir, 'older.ndjson');
    const end = lines.at(-1) as BundleLine & { counts: Record<string, number> };
    const stale = {
      type: 'deliveryRole',
      id: randomUUID(),
      key: 'other-only',
      name: 'other-only',
      description: '',
      permissions: readGrants([secret.definition.id]),
    };
    const counts = { ...end.counts, deliveryRole: (end.counts.deliveryRole ?? 0) + 1 };
    await writeFile(
      older,
      [...lines.slice(0, -1), stale, { ...end, counts }].map((line) => JSON.stringify(line)).join('\n') +
        '\n',
    );

    target = await startInstance(await createTestDatabase());
    worker = startWorker(target);
    const args = ['--url', target.url, '--token', target.adminToken, '--site', 'default'];
    const planned = await runCli('import', [...args, '--dry-run', older]);
    expect(planned, planned.stderr).toMatchObject({ code: 0 });
    expect(planned.stdout).toContain('role other-only: left out its grants on 1 model(s)');
    const imported = await runCli('import', [...args, older]);
    expect(imported, `${imported.stdout}\n${imported.stderr}`).toMatchObject({ code: 0 });
    const roles = await target.database.db
      .selectFrom('admin_roles')
      .select('key')
      .where('kind', '=', 'delivery')
      .where('is_system', '=', false)
      .execute();
    expect(roles.map((role) => role.key)).toEqual(['mixed']);
  });
});
