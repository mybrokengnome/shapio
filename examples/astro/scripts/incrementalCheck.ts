import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createClient } from '@shapio/client';
import { connectAdmin, type AdminConnection } from '../../shared/scripts/lib/admin.js';

/**
 * `npm run check:incremental`, after `npm run seed`: checks Astro's incremental build end to end against a running
 * Shapio. Each step runs `astro build`:
 * 1. a full build (`--force`), kept as the reference;
 * 2. the same snapshot again: every keyed page is restored, and dist/ matches the reference except build.json
 *    (its `builtAt` changes on every build);
 * 3. the same content pinned with SHAPIO_SNAPSHOT (as a webhook-triggered build is): every keyed page is still
 *    restored, so no setting's value leaks into the code Astro hashes;
 * 4. one article's English title edited and published: only that page re-renders among the keyed ones, with the
 *    new title (the title is put back afterwards);
 * 5. the cache removed: a full build, nothing restored.
 * Changes content (and puts it back): run it after anything else that reads the seeded site. Needs
 * SHAPIO_ADMIN_EMAIL and SHAPIO_ADMIN_PASSWORD (or SHAPIO_TOKEN) to publish the edit, as the seed does.
 */
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const CACHE_DIR = join(ROOT, 'node_modules', '.astro');
const MANIFEST = join(CACHE_DIR, 'incremental-build.json');
const ARTICLE = 'modelling-without-a-deploy';
const EDITED_PAGE = `en/articles/${ARTICLE}/index.html`;
/** Always rendered, and carries the build time: the only file two builds of one snapshot may differ in. */
const TIMESTAMPED = new Set(['build.json']);
/** How long a publish may take to become the current snapshot: polled, so a fast server costs nothing. */
const SNAPSHOT_WITHIN_MS = 30_000;
const POLL_EVERY_MS = 250;

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${message}\n`);
  if (!condition) {
    failures.push(message);
  }
};
const say = (line: string) => process.stdout.write(`${line}\n`);

/** Runs `astro build` (with `npm run build`, as a site's host does) and returns its output. */
const build = (args: string[] = [], env: NodeJS.ProcessEnv = {}) =>
  new Promise<string>((resolveBuild, reject) => {
    const child = spawn('npm', ['run', 'build', '--', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveBuild(output) : reject(new Error(`astro build exited with ${code}:\n${output}`)),
    );
  });

type Manifest = { routes: Record<string, { paths: Record<string, { outputFile: string }> }> };

/** The output files of every keyed page (a page whose getStaticPaths entry has a cacheKey). */
const keyedFiles = async (): Promise<string[]> => {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest;
  return Object.values(manifest.routes)
    .flatMap((route) => Object.values(route.paths).map((path) => path.outputFile))
    .sort();
};

/** How a build treated each keyed page: Astro logs `├─ /<file> (restored)` for one it did not render. */
const outcomes = (output: string, files: string[]) => {
  const lines = output.split('\n');
  const restored = files.filter((file) =>
    lines.some((line) => line.includes(` /${file} `) && /\((restored|cached)\)/.test(line)),
  );
  return { restored, rendered: files.filter((file) => !restored.includes(file)) };
};

const listTree = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();

/** Files that differ between two output directories (missing on either side, or different bytes). */
const differences = async (left: string, right: string): Promise<string[]> => {
  const [a, b] = await Promise.all([listTree(left), listTree(right)]);
  const all = [...new Set([...a, ...b])].sort();
  const differing: string[] = [];
  for (const file of all) {
    if (!a.includes(file) || !b.includes(file)) {
      differing.push(file);
      continue;
    }
    const [x, y] = await Promise.all([readFile(join(left, file)), readFile(join(right, file))]);
    if (!x.equals(y)) {
      differing.push(file);
    }
  }
  return differing;
};

const delivery = () => {
  const token = process.env.SHAPIO_DELIVERY_TOKEN;
  if (!token) {
    throw new Error('Set SHAPIO_DELIVERY_TOKEN (npm run seed writes it to .env)');
  }
  return createClient({ baseUrl: process.env.SHAPIO_URL ?? 'http://localhost:4300', token });
};

/** Waits until the current snapshot is past `after` (a real condition, not a fixed wait). */
const waitForSnapshotAfter = async (after: number) => {
  const deadline = Date.now() + SNAPSHOT_WITHIN_MS;
  while (Date.now() < deadline) {
    const { snapshot } = await delivery().snapshots.current();
    if (snapshot > after) {
      return snapshot;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_EVERY_MS));
  }
  throw new Error(`No snapshot after ${after} within ${SNAPSHOT_WITHIN_MS} ms of publishing`);
};

/** Saves and publishes the article's English title; returns a function that publishes the old one again. */
const publishTitle = async ({ client }: AdminConnection, title: string) => {
  const [item] = (
    await client.admin.content.list('article', { locale: 'en', filters: { slug: { $eq: ARTICLE } } })
  ).items;
  if (!item) {
    throw new Error(`The seeded article "${ARTICLE}" is missing; run npm run seed first`);
  }
  const entry = await client.admin.content.get('article', item.id, { locale: 'en' });
  const original = entry.data.title;
  const publish = async (expectedVersion: number, value: unknown) => {
    const before = (await delivery().snapshots.current()).snapshot;
    const saved = await client.admin.content.update('article', item.id, {
      locale: 'en',
      expectedVersion,
      data: { title: value },
    });
    await client.admin.content.publish('article', item.id, { locales: ['en'] });
    await waitForSnapshotAfter(before);
    return saved.version;
  };
  const version = await publish(entry.version, title);
  return () => publish(version, original);
};

const main = async () => {
  const reference = await mkdtemp(join(tmpdir(), 'shapio-astro-incremental-'));
  const admin = await connectAdmin(process.env);
  try {
    say('1. Full build (--force)');
    await build(['--force']);
    await cp(DIST, reference, { recursive: true });
    const keyed = await keyedFiles();
    check(keyed.length > 0, `${keyed.length} keyed pages recorded in the cache`);

    say('2. The same snapshot again');
    const second = outcomes(await build(), keyed);
    check(
      second.rendered.length === 0,
      `${second.restored.length}/${keyed.length} keyed pages restored${second.rendered.length > 0 ? `; rendered: ${second.rendered.join(', ')}` : ''}`,
    );
    const changed = await differences(reference, DIST);
    check(
      changed.every((file) => TIMESTAMPED.has(file)),
      `dist/ matches the full build except build.json (differs: ${changed.join(', ') || 'nothing'})`,
    );

    say('3. The same content, pinned with SHAPIO_SNAPSHOT');
    const { snapshot } = await delivery().snapshots.current();
    const pinned = outcomes(await build([], { SHAPIO_SNAPSHOT: String(snapshot) }), keyed);
    check(
      pinned.rendered.length === 0,
      `${pinned.restored.length}/${keyed.length} keyed pages restored with SHAPIO_SNAPSHOT=${snapshot}${pinned.rendered.length > 0 ? `; rendered: ${pinned.rendered.join(', ')}` : ''}`,
    );

    say('4. One article edited and published');
    const marker = `Incremental check ${Date.now()}`;
    const restore = await publishTitle(admin, marker);
    try {
      const third = outcomes(await build(), keyed);
      check(
        third.rendered.length === 1 && third.rendered[0] === EDITED_PAGE,
        `only ${EDITED_PAGE} re-rendered among keyed pages (rendered: ${third.rendered.join(', ') || 'none'}; restored ${third.restored.length})`,
      );
      check(
        (await readFile(join(DIST, EDITED_PAGE), 'utf8')).includes(marker),
        `${EDITED_PAGE} has the new title`,
      );
    } finally {
      await restore();
    }

    say('5. No cache');
    await rm(CACHE_DIR, { recursive: true, force: true });
    const fourth = await build();
    check(!/\((restored|cached)\)/.test(fourth), 'a build without the cache renders every page');
    const afterRestore = await differences(reference, DIST);
    check(
      afterRestore.every((file) => TIMESTAMPED.has(file)),
      `with the title put back, dist/ matches the first build except build.json (differs: ${afterRestore.join(', ') || 'nothing'})`,
    );
  } finally {
    await admin.close();
    await rm(reference, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} check(s) failed`);
  }
  say('Incremental build check passed.');
};

main().catch((error: unknown) => {
  process.stderr.write(`check:incremental: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
