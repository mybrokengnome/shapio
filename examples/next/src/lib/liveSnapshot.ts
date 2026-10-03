import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configuredSnapshot, isSnapshotPinned } from './config';
import { log } from './log';

/**
 * The publication snapshot the site reads. `next build` renders every page at the snapshot next.config.ts
 * pinned; under `next start`, /api/revalidate moves the site forward to each new snapshot Shapio reports and
 * revalidates the pages that changed, which then re-render at that snapshot.
 *
 * The last handled snapshot lives in memory (on `globalThis`, which the route handler and the pages share in
 * the one `next start` process) and in `.next/shapio-revalidate.json`, so a restart carries on from it. The
 * file sits in `.next/`, which `next build` empties, so a new build starts again from its own snapshot.
 * A build pinned with SHAPIO_SNAPSHOT ignores both: it keeps showing that snapshot.
 */
const STATE_FILE = join(process.cwd(), '.next', 'shapio-revalidate.json');

type LiveState = { snapshot: number | undefined; loaded: boolean };
const holder = globalThis as typeof globalThis & { __shapioLiveSnapshot?: LiveState };
const state = (): LiveState => (holder.__shapioLiveSnapshot ??= { snapshot: undefined, loaded: false });

const buildSnapshot = (): number => {
  const pinned = configuredSnapshot();
  if (pinned === undefined) {
    throw new Error('No pinned snapshot: next.config.ts sets SHAPIO_SNAPSHOT when `next build` starts');
  }
  return pinned;
};

const readStateFile = (): number | undefined => {
  try {
    const { snapshot } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { snapshot?: unknown };
    return typeof snapshot === 'number' && Number.isInteger(snapshot) && snapshot >= 0 ? snapshot : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`Ignoring ${STATE_FILE} (${error instanceof Error ? error.message : String(error)})`);
    }
    return undefined;
  }
};

/** The snapshot every delivery read sends: the build's, or the last one /api/revalidate handled. */
export const liveSnapshot = (): number => {
  const built = buildSnapshot();
  if (isSnapshotPinned()) {
    return built;
  }
  const current = state();
  if (!current.loaded) {
    current.snapshot = readStateFile();
    current.loaded = true;
  }
  return Math.max(built, current.snapshot ?? built);
};

/**
 * Moves the site to `snapshot` while `revalidate` runs (pages it marks stale re-render at the new snapshot),
 * then records it on disk. If `revalidate` throws, the site stays where it was.
 */
export const advanceTo = async (snapshot: number, revalidate: () => void | Promise<void>) => {
  const current = state();
  const previous = liveSnapshot();
  current.snapshot = snapshot;
  try {
    await revalidate();
  } catch (error) {
    current.snapshot = previous;
    throw error;
  }
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ snapshot, updatedAt: new Date().toISOString() })}\n`);
  renameSync(temporary, STATE_FILE);
};
