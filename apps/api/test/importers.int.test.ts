import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REMOTE_COMMANDS, type CliIo } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStrapiExport } from '../../../packages/cli/src/testing/strapiExport.js';
import { SITE_HEADER } from '../src/constants/sites.js';
import { expectStatus, runContentSchemaJobs } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import { createPng } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * The importers end to end (agentic plan §B3, §F "WordPress WXR and a Strapi export import into reviewable
 * change sets"): `shapio import … --plan`, `shapio schema apply` of the planned files, then `--map` against a
 * listening instance. Media are downloaded from a local stand-in for the WordPress site.
 */
const WXR_FIXTURE = resolve(API_ROOT, '../../packages/cli/test/fixtures/wxr/blog.xml');

type ImportMapState = {
  state: {
    media: Record<string, { assetId: string }>;
    entries: Record<string, { entryId: string; locales: string[]; complete: boolean }>;
    failed: Record<string, string>;
    changeSets: Array<{ id: string; title: string }>;
  };
};

type ChangeSetBody = {
  status: string;
  title: string;
  items: Array<{ kind: string; entryId: string; modelKey: string; locale: string; action: string }>;
};

type EntryBody = { id: string; status: string; data: Record<string, unknown> };

const runCli = async (command: 'import' | 'schema', args: string[], env: Record<string, string>) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env };
  const code = await REMOTE_COMMANDS[command]!.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

/** Serves PNGs for any path: the WordPress site's uploads and another host's image. */
const startMediaServer = async () => {
  const png = await createPng(8, 6);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
    response.end(png);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, requests, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

type Instance = {
  admin: SchemaClient;
  env: Record<string, string>;
  workdir: string;
  media: { server: Server; requests: string[]; origin: string };
  readMap: (dir: string) => Promise<ImportMapState>;
  changeSet: (id: string) => Promise<ChangeSetBody>;
  entry: (model: string, id: string, locale?: string) => Promise<EntryBody>;
  applyPlan: (dir: string, extra?: string[]) => Promise<void>;
};

/** A listening instance on its own database (each importer plans models with the same API IDs). */
const useImportInstance = (): Instance => {
  const database = useTestDatabase();
  const instance = {} as Instance;
  let testApp: TestApp | undefined;

  beforeAll(async () => {
    instance.workdir = await mkdtemp(join(tmpdir(), 'shapio-importers-'));
    testApp = await createTestApp(database.current, {
      env: { MEDIA_PATH: join(instance.workdir, 'storage') },
    });
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    const token = await createRoleToken(database.current.db, 'owner');
    const admin = schemaClient(testApp.app, token);
    const env = {
      SHAPIO_URL: `http://127.0.0.1:${(testApp.app.server.address() as AddressInfo).port}`,
      SHAPIO_TOKEN: token,
    };
    Object.assign(instance, {
      admin,
      env,
      media: await startMediaServer(),
      readMap: async (dir: string) =>
        JSON.parse(await readFile(join(dir, 'import-map.json'), 'utf8')) as ImportMapState,
      changeSet: async (id: string) =>
        expectStatus(await admin.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSetBody>(),
      entry: async (model: string, id: string, locale?: string) =>
        expectStatus(
          await admin.get(`/api/admin/content/${model}/${id}${locale ? `?locale=${locale}` : ''}`),
          200,
        ).json<EntryBody>(),
      // `schema apply` of the plan's files; activation jobs run here (the test app has no worker).
      applyPlan: async (dir: string, extra: string[] = []) => {
        const applied = await runCli(
          'schema',
          [
            'apply',
            '--dir',
            join(dir, 'schema'),
            '--lock',
            join(dir, 'schema-lock.json'),
            '--no-wait',
            ...extra,
          ],
          env,
        );
        expect(applied.code, applied.stderr).toBe(0);
        await runContentSchemaJobs(database.current.db);
      },
    });
  });

  afterAll(async () => {
    await testApp?.app.close();
    await new Promise((done) => instance.media?.server.close(done));
    await rm(instance.workdir, { recursive: true, force: true });
  });

  return instance;
};

describe('shapio import wordpress', () => {
  const instance = useImportInstance();

  it('imports a WordPress export into drafts, media and one reviewable change set, and resumes idempotently', async () => {
    const wxr = join(instance.workdir, 'blog.xml');
    await writeFile(
      wxr,
      (await readFile(WXR_FIXTURE, 'utf8'))
        .replaceAll('http://blog.test', instance.media.origin)
        .replaceAll('https://cdn.example.org', `${instance.media.origin}/cdn`),
    );
    const dir = join(instance.workdir, 'wordpress');

    const planned = await runCli('import', ['wordpress', wxr, '--plan', dir], instance.env);
    expect(planned.code, planned.stderr).toBe(0);
    expect(planned.stdout).toContain('Planned 5 definition(s)');
    const refused = await runCli('import', ['wordpress', '--map', dir], instance.env);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('does not have the planned models yet');

    await instance.applyPlan(dir);
    const mapped = await runCli('import', ['wordpress', '--map', dir], instance.env);
    expect(mapped.code, mapped.stderr).toBe(0);
    expect(mapped.stdout).toMatch(
      /Change set "Import from WordPress": http:\/\/127\.0\.0\.1:\d+\/admin\/changes\//,
    );
    expect(mapped.stdout).toContain('1 WordPress shortcodes kept as text');

    const map = await instance.readMap(dir);
    expect(map.state.failed).toEqual({});
    expect(Object.keys(map.state.media).sort()).toEqual(
      [`url:${instance.media.origin}/cdn/diagram.png`, 'attachment:10'].sort(),
    );
    expect(Object.keys(map.state.entries)).toHaveLength(9);
    expect(map.state.changeSets).toHaveLength(1);

    const set = await instance.changeSet(map.state.changeSets[0]!.id);
    expect(set.status).toBe('open');
    // Everything published in WordPress (author, 4 terms, 1 post, 2 pages); the draft post stays out.
    expect(set.items.filter((item) => item.kind === 'entry')).toHaveLength(8);
    expect(set.items.every((item) => item.action === 'publish')).toBe(true);
    const ids = (sourceId: string) => map.state.entries[sourceId]!.entryId;
    expect(set.items.some((item) => item.entryId === ids('post:21'))).toBe(false);

    const post = await instance.entry('post', ids('post:20'));
    expect(post.status).toBe('draft');
    const engine = map.state.media['attachment:10']!.assetId;
    expect(post.data).toMatchObject({
      title: 'On the Analytical Engine',
      slug: 'analytical-engine',
      date: '2024-05-02T09:30:00.000Z',
      author: ids('author:ada'),
      categories: [ids('category:analytical')],
      tags: [ids('tag:history'), ids('tag:looms')],
    });
    // The admin read expands media fields into asset objects.
    expect((post.data.cover as { id: string }).id).toBe(engine);
    const body = JSON.stringify(post.data.body);
    expect(body).toContain(engine);
    expect(body).toContain(map.state.media[`url:${instance.media.origin}/cdn/diagram.png`]!.assetId);
    expect((await instance.entry('page', ids('page:31'))).data.parent).toBe(ids('page:30'));
    expect((await instance.entry('category', ids('category:analytical'))).data.parent).toBe(
      ids('category:engines'),
    );
    const asset = expectStatus(await instance.admin.get(`/api/admin/media/assets/${engine}`), 200).json<{
      alt: string;
      caption: string;
    }>();
    expect(asset).toMatchObject({ alt: 'The difference engine', caption: 'The engine, drawn.' });

    const downloads = instance.media.requests.length;
    const again = await runCli('import', ['wordpress', '--map', dir], instance.env);
    expect(again.code, again.stderr).toBe(0);
    expect(instance.media.requests).toHaveLength(downloads);
    const after = await instance.readMap(dir);
    expect(after.state.entries).toEqual(map.state.entries);
    expect(after.state.changeSets).toEqual(map.state.changeSets);
    expect((await instance.changeSet(map.state.changeSets[0]!.id)).items).toHaveLength(8);
    const posts = expectStatus(await instance.admin.get('/api/admin/content/post'), 200).json<{
      items: unknown[];
    }>();
    expect(posts.items).toHaveLength(2);
  });
});

describe('shapio import onto one site of several', () => {
  const instance = useImportInstance();

  it("plans with --site into the site's folder; the models and entries belong to that site only", async () => {
    expectStatus(await instance.admin.post('/api/admin/sites', { key: 'blog', name: 'Blog' }), 201);
    const wxr = join(instance.workdir, 'blog.xml');
    await writeFile(
      wxr,
      (await readFile(WXR_FIXTURE, 'utf8'))
        .replaceAll('http://blog.test', instance.media.origin)
        .replaceAll('https://cdn.example.org', `${instance.media.origin}/cdn`),
    );
    const dir = join(instance.workdir, 'wordpress-blog');
    const planned = await runCli('import', ['wordpress', wxr, '--plan', dir, '--site', 'blog'], instance.env);
    expect(planned.code, planned.stderr).toBe(0);
    expect(planned.stdout).toContain('will belong to site "blog"');
    expect(planned.stdout).toContain('--site blog');
    expect(await readFile(join(dir, 'schema', 'sites', 'blog', 'models', 'post.json'), 'utf8')).toContain(
      '"apiKey": "post"',
    );

    await instance.applyPlan(dir, ['--site', 'blog']);
    // Another site than the planned one is refused, before anything is sent.
    const elsewhere = await runCli('import', ['wordpress', '--map', dir, '--site', 'default'], instance.env);
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.stderr).toContain('planned for site "blog", not "default"');
    // Without --site, --map imports into the site the plan recorded.
    const mapped = await runCli('import', ['wordpress', '--map', dir], instance.env);
    expect(mapped.code, mapped.stderr).toBe(0);
    expect(mapped.stdout).toContain('/admin/s/blog/changes/');

    type Listed = { items: Array<{ definition: { apiKey: string }; scope: string }> };
    const onBlog = expectStatus(
      await instance.admin.request({
        method: 'GET',
        url: '/api/admin/models',
        headers: { [SITE_HEADER]: 'blog' },
      }),
      200,
    ).json<Listed>();
    expect(onBlog.items.find((item) => item.definition.apiKey === 'post')?.scope).toBe('site');
    const onDefault = expectStatus(await instance.admin.get('/api/admin/models'), 200).json<Listed>();
    expect(onDefault.items.map((item) => item.definition.apiKey)).not.toContain('post');
    const posts = await instance.admin.request({
      method: 'GET',
      url: '/api/admin/content/post',
      headers: { [SITE_HEADER]: 'blog' },
    });
    expect(expectStatus(posts, 200).json<{ items: unknown[] }>().items.length).toBeGreaterThan(0);
  });
});

describe('shapio import strapi', () => {
  const instance = useImportInstance();

  it('imports a Strapi 5 export with locales, components, a dynamic zone and a relation cycle', async () => {
    expectStatus(await instance.admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const archive = await buildStrapiExport(join(instance.workdir, 'strapi-source'), { key: 'k3y' });
    const dir = join(instance.workdir, 'strapi');

    const planned = await runCli('import', ['strapi', archive, '--plan', dir, '--key', 'k3y'], instance.env);
    expect(planned.code, planned.stderr).toBe(0);
    expect(planned.stdout).toContain('Draft and publish is turned on for author');
    await instance.applyPlan(dir);
    const mapped = await runCli('import', ['strapi', '--map', dir], instance.env);
    expect(mapped.code, `${mapped.stdout}\n${mapped.stderr}`).toBe(0);

    const map = await instance.readMap(dir);
    expect(map.state.failed).toEqual({});
    const ids = (sourceId: string) => map.state.entries[sourceId]!.entryId;
    const articleId = ids('strapi:api::article.article:a1');
    const authorId = ids('strapi:api::author.author:u1');
    expect(map.state.entries['strapi:api::article.article:a1']?.locales).toEqual(['en', 'fr']);
    expect(map.state.entries['strapi:api::author.author:u1']?.complete).toBe(true);

    const en = await instance.entry('article', articleId, 'en');
    const cover = map.state.media['file:20']!.assetId;
    expect(en.data).toMatchObject({
      title: 'Hello',
      slug: 'hello-world',
      statusField: 'in-review',
      kind: 'news',
      price: '9.5',
      author: authorId,
      tags: [ids('strapi:api::tag.tag:t1')],
      seo: { metaTitle: 'Hello (SEO)' },
      sections: [
        { __component: 'quote', text: 'Q', by: authorId },
        { __component: 'seo', metaTitle: 'Z' },
      ],
    });
    expect(en.data.cover).toMatchObject({ id: cover, filename: 'cover.png', alt: 'A cover' });
    expect(JSON.stringify(en.data.seo)).toContain(cover);
    expect(JSON.stringify(en.data.body)).toContain(cover);
    expect((await instance.entry('article', articleId, 'fr')).data.title).toBe('Bonjour');
    expect((await instance.entry('author', authorId)).data.bestArticle).toBe(articleId);
    expect((await instance.entry('homepage', ids('strapi:api::homepage.homepage:h1'))).data.headline).toBe(
      'New',
    );

    const set = await instance.changeSet(map.state.changeSets[0]!.id);
    expect(set.title).toBe('Import from Strapi');
    // Published in Strapi: article (en), author (no draft and publish there), homepage; the tag and fr are drafts.
    expect(set.items.map((item) => `${item.modelKey}/${item.locale}`).sort()).toEqual([
      'article/en',
      'author/en',
      'homepage/en',
    ]);
  });
});
