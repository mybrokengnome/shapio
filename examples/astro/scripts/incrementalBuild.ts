import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient, ShapioApiError, type SnapshotChange } from '@shapio/client';

/**
 * `npm run build:incremental [--dry-run]`: builds only when content changed.
 *
 * It asks Shapio what changed between the snapshot the last build showed (`dist/build.json`, or
 * SHAPIO_FROM_SNAPSHOT) and the current one (`/api/snapshots/changes`), prints the routes those changes
 * touch, and runs `astro build` pinned to the new snapshot, or skips the build when nothing changed. A
 * schema change between the two snapshots, or no previous build, means a full rebuild. The printed routes
 * are what a server-rendered site would revalidate (documentation/snapshots.md shows `revalidatePath`).
 *
 * Settings: SHAPIO_URL and SHAPIO_DELIVERY_TOKEN (as for `npm run build`), SHAPIO_FROM_SNAPSHOT (optional).
 */
const DIST_BUILD_INFO = resolve(import.meta.dirname, '../dist/build.json');

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} (npm run seed writes it to .env)`);
  }
  return value;
};

const client = createClient({
  baseUrl: process.env.SHAPIO_URL ?? 'http://localhost:4300',
  token: requireEnv('SHAPIO_DELIVERY_TOKEN'),
});

/** The snapshot the previous build showed, if there was one. */
const previousSnapshot = async (): Promise<number | undefined> => {
  const configured = process.env.SHAPIO_FROM_SNAPSHOT;
  if (configured) {
    const value = Number(configured);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`SHAPIO_FROM_SNAPSHOT must be a snapshot number, got "${configured}"`);
    }
    return value;
  }
  try {
    const info = JSON.parse(await readFile(DIST_BUILD_INFO, 'utf8')) as { snapshot?: unknown };
    return typeof info.snapshot === 'number' ? info.snapshot : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

/** The entry's slug in `locale` at `snapshot` (null when it is not there). */
const slugAt = async (change: SnapshotChange, locale: string, snapshot: number): Promise<string | null> => {
  const query = new URLSearchParams({ locale, snapshot: String(snapshot), fields: 'slug' });
  try {
    const result = await client.request<{ data: { slug?: unknown } }>(
      `/api/content/${change.routeKey}/${change.id}?${query.toString()}`,
    );
    return typeof result.data.slug === 'string' ? result.data.slug : null;
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

/** Site routes (src/pages) an entry change touches. */
const routesOf = async (change: SnapshotChange, from: number, to: number): Promise<string[]> => {
  const routes: string[] = [];
  for (const { locale, change: kind } of change.locales) {
    if (change.modelKey === 'author') {
      routes.push(`/${locale}/articles/`);
      continue;
    }
    // An unpublished entry's route is where it was; the others are where they are now.
    const slug = await slugAt(change, locale, kind === 'unpublished' ? from : to);
    if (slug === null) {
      continue;
    }
    if (change.modelKey === 'page') {
      routes.push(slug === 'home' ? `/${locale}/` : `/${locale}/${slug}/`);
    } else if (change.modelKey === 'article') {
      routes.push(`/${locale}/articles/${slug}/`, `/${locale}/articles/`);
    }
  }
  return routes;
};

const runBuild = (snapshot: number) =>
  new Promise<void>((resolveBuild, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, SHAPIO_SNAPSHOT: String(snapshot) },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveBuild() : reject(new Error(`astro build exited with ${code}`)),
    );
  });

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const { snapshot: to } = await client.snapshots.current();
  const from = await previousSnapshot();
  const say = (line: string) => process.stdout.write(`${line}\n`);

  if (from === undefined) {
    say(`No previous build: building everything at snapshot ${to}.`);
  } else if (from === to) {
    say(`Nothing published since snapshot ${from}: skipping the build.`);
    return;
  } else {
    const diff = await client.snapshots.allChanges({ from, to });
    if (diff.items.length === 0) {
      say(`Snapshots ${from} → ${to} change nothing this site reads: skipping the build.`);
      return;
    }
    if (diff.schemaVersions.from !== diff.schemaVersions.to) {
      say(`The schema changed between snapshots ${from} and ${to}: rebuilding every route.`);
    } else {
      const routes = new Set<string>();
      for (const change of diff.items) {
        (await routesOf(change, from, to)).forEach((route) => routes.add(route));
      }
      say(`Snapshots ${from} → ${to}: ${diff.items.length} changed entries; routes to refresh:`);
      [...routes].sort().forEach((route) => say(`  ${route}`));
    }
  }
  if (dryRun) {
    say('--dry-run: not building.');
    return;
  }
  await runBuild(to);
};

main().catch((error: unknown) => {
  process.stderr.write(`build:incremental: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
