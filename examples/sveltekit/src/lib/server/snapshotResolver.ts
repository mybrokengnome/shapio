/**
 * Which publication snapshot the site reads, and for how long a read is reused. A build pins one snapshot
 * for all its pages (SHAPIO_SNAPSHOT, else the current one when the build starts). The dev server reads the
 * current snapshot again once the last read is older than DEV_WINDOW_MS, so a publish shows on reload while
 * the reads of one page render still share a snapshot.
 */
export const DEV_WINDOW_MS = 1000;

/** How long a cached read is reused: for the whole process in a build, DEV_WINDOW_MS in dev. */
export const cacheWindow = (dev: boolean): number => (dev ? DEV_WINDOW_MS : Number.POSITIVE_INFINITY);

/** `read`, reused for `windowMs` after it starts. A read that fails is not kept: the next call tries again. */
export const cachedRead = <T>(
  read: () => Promise<T>,
  windowMs: number,
  now: () => number = Date.now,
): (() => Promise<T>) => {
  let cached: { value: Promise<T>; at: number } | undefined;
  return () => {
    const at = now();
    if (cached && at - cached.at < windowMs) {
      return cached.value;
    }
    const entry = { value: read(), at };
    cached = entry;
    entry.value.catch(() => {
      if (cached === entry) {
        cached = undefined;
      }
    });
    return entry.value;
  };
};

type SnapshotResolverOptions = {
  /** True under the dev server. */
  dev: boolean;
  /** SHAPIO_SNAPSHOT: when set, the site shows exactly this snapshot, in dev too. */
  configured: number | undefined;
  /** Reads Shapio's current publication snapshot. */
  current: () => Promise<number>;
  now?: () => number;
};

/** The snapshot every delivery read sends. */
export const createSnapshotResolver = ({
  dev,
  configured,
  current,
  now,
}: SnapshotResolverOptions): (() => Promise<number>) =>
  configured === undefined ? cachedRead(current, cacheWindow(dev), now) : () => Promise.resolve(configured);
