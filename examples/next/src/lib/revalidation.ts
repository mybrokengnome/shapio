import { ShapioApiError, type SnapshotChange, type SnapshotChangeKind } from '@shapio/client';
import { revalidatePath } from 'next/cache';
import { configuredSnapshot, isSnapshotPinned } from './config';
import { advanceTo, liveSnapshot } from './liveSnapshot';
import { log } from './log';
import {
  EVERY_PAGE,
  revalidationTargets,
  type ChangedEntry,
  type RevalidationTarget,
} from './revalidationTargets';
import { shapio } from './shapio';

/**
 * On-demand revalidation (`next start`): asks Shapio what changed between the snapshot the site shows and
 * the current one (`/api/snapshots/changes`), revalidates the pages those changes touch and moves the site to
 * the new snapshot. The diff, not the event, is the source of truth: one call covers a change set's many
 * entries, retried or missed deliveries, and both locales of a publish.
 */
export type RevalidationResult =
  { from: number; to: number; changed: number; revalidated: RevalidationTarget[] } | { skipped: string };

/** Models whose pages are addressed by slug. */
const SLUGGED_MODELS: ReadonlySet<string> = new Set(['page', 'article']);

/** The entry's slug in `locale` at `snapshot`; null when it was not published there. */
const slugAt = async (change: SnapshotChange, locale: string, snapshot: number): Promise<string | null> => {
  try {
    const { data } = await shapio().delivery.get<{ slug?: unknown }>(change.routeKey, change.id, {
      locale,
      snapshot,
      fields: ['slug'],
    });
    return typeof data.slug === 'string' ? data.slug : null;
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

/** Where the entry was (unpublished), is (published), or both (updated: the slug may have changed). */
const slugSnapshots = (kind: SnapshotChangeKind, from: number, to: number): number[] =>
  kind === 'published' ? [to] : kind === 'unpublished' ? [from] : [from, to];

const changedEntries = async (items: readonly SnapshotChange[], from: number, to: number) => {
  const lookups = items.flatMap((change) =>
    change.locales.map(async ({ locale, change: kind }): Promise<ChangedEntry> => {
      if (!SLUGGED_MODELS.has(change.modelKey)) {
        return { modelKey: change.modelKey, locale, slugs: [] };
      }
      const slugs = await Promise.all(slugSnapshots(kind, from, to).map((at) => slugAt(change, locale, at)));
      const found = slugs.filter((slug): slug is string => slug !== null);
      return { modelKey: change.modelKey, locale, slugs: [...new Set(found)] };
    }),
  );
  return Promise.all(lookups);
};

const revalidateNow = async (): Promise<RevalidationResult> => {
  if (isSnapshotPinned()) {
    return { skipped: `the build is pinned to snapshot ${configuredSnapshot()} by SHAPIO_SNAPSHOT` };
  }
  const from = liveSnapshot();
  const { snapshot: to } = await shapio().snapshots.current();
  if (to <= from) {
    return { from, to: from, changed: 0, revalidated: [] };
  }
  const diff = await shapio().snapshots.allChanges({ from, to });
  const { schemaVersions } = diff;
  const schemaChanged = schemaVersions.from === null || schemaVersions.from !== schemaVersions.to;
  const targets = revalidationTargets(await changedEntries(diff.items, from, to), schemaChanged);
  await advanceTo(to, () => {
    for (const target of targets) {
      revalidatePath(target.path, target.type);
    }
  });
  return { from, to, changed: diff.items.length, revalidated: targets };
};

/** One run at a time: deliveries that arrive together diff from the snapshot the previous run reached. */
let queue: Promise<unknown> = Promise.resolve();

export const revalidateChanges = (): Promise<RevalidationResult> => {
  const run = queue.then(revalidateNow, revalidateNow);
  queue = run.catch(() => undefined);
  return run.then((result) => {
    log(
      'skipped' in result
        ? `Revalidation skipped: ${result.skipped}`
        : `Snapshots ${result.from} → ${result.to}: revalidated ${result.revalidated.length} path(s)`,
    );
    return result;
  });
};

/**
 * Site-wide changes that publish no snapshot (the site's SEO defaults: `site.updated`): every page is
 * revalidated at the snapshot the site already shows.
 */
export const revalidateEveryPage = (): RevalidationResult => {
  if (isSnapshotPinned()) {
    return { skipped: `the build is pinned to snapshot ${configuredSnapshot()} by SHAPIO_SNAPSHOT` };
  }
  revalidatePath(EVERY_PAGE.path, EVERY_PAGE.type);
  const at = liveSnapshot();
  log(`Site settings changed: revalidated every page at snapshot ${at}`);
  return { from: at, to: at, changed: 0, revalidated: [EVERY_PAGE] };
};
