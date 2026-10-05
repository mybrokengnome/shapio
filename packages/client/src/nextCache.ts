/**
 * Next.js data-cache support for delivery reads. Under Next (`process.env.NEXT_RUNTIME` is set) or when the
 * client is given a `next` option, every delivery read passes `next: { tags }` to `fetch`, so a site can
 * refresh exactly what changed with `revalidateTag`. The cache mode is only set when asked for, except that a
 * read pinned to a publication snapshot is immutable and always `force-cache`, and a drafts-mode read is never
 * cached or tagged (`no-store`). Elsewhere nothing is added.
 */

/** Next's `fetch` cache modes the client passes through. */
export type NextCacheMode = 'force-cache' | 'no-store';

export type NextCacheOptions = {
  /** Next's `fetch` `cache` option. Unset: Next's own default, except pinned snapshot reads (`force-cache`). */
  cache?: NextCacheMode;
  /** Seconds a cached response stays fresh (`next.revalidate`); `false` keeps it until a tag is revalidated. */
  revalidate?: number | false;
};

/** The last argument of every delivery read: overrides the client's `next` option; `false` adds nothing. */
export type DeliveryReadOptions = { next?: NextCacheOptions | false };

/** What a delivery read adds to its `fetch` init. */
export type NextFetchInit = {
  cache?: NextCacheMode;
  next?: { tags: string[]; revalidate?: number | false };
};

const TAG_PREFIX = 'shapio';

/**
 * The cache tags delivery reads carry (`revalidateTag(shapioTags.entry('articles', id), { expire: 0 })`).
 * Models are named by their route key: a collection's plural API ID, a singleton's API ID.
 */
export const shapioTags = {
  /** Every delivery read of the site; `shapio:site` when the client names no site. */
  site: (siteKey?: string) =>
    siteKey === undefined ? `${TAG_PREFIX}:site` : `${TAG_PREFIX}:site:${siteKey}`,
  /** Every read of one model (lists, singletons and its entries). */
  model: (routeKey: string) => `${TAG_PREFIX}:${routeKey}`,
  /** Reads of one entry by its ID. */
  entry: (routeKey: string, entryId: string) => `${TAG_PREFIX}:${routeKey}:${entryId}`,
} as const;

/** Spelled out so bundlers that inline `process.env.NEXT_RUNTIME` see it; guarded for browsers. */
const isNextRuntime = (): boolean => {
  try {
    return typeof process !== 'undefined' && Boolean(process.env.NEXT_RUNTIME);
  } catch {
    return false;
  }
};

/** What every delivery read needs to tag itself: the client's site, `next` option and drafts mode. */
export type DeliveryCacheContext = {
  site: string | undefined;
  next: NextCacheOptions | false | undefined;
  /** Drafts mode (`drafts: true`): reads ask for drafts, which are never cached. */
  drafts: boolean;
};

export type NextReadInput = {
  /** The client's `next` option. */
  client: NextCacheOptions | false | undefined;
  /** The read's own `next` option. */
  read: NextCacheOptions | false | undefined;
  tags: string[];
  /** The read names a publication snapshot (immutable). */
  pinned: boolean;
  /** Drafts mode: under Next (or with any `next` option) the read is `no-store` and untagged. */
  drafts?: boolean;
};

/** The `cache` and `next` fetch options of one delivery read; empty outside Next unless asked for. */
export const nextFetchInit = ({
  client,
  read,
  tags,
  pinned,
  drafts = false,
}: NextReadInput): NextFetchInit => {
  if (drafts) {
    // Drafts change on every save: never in Next's data cache, never tagged, whatever the `next` options say.
    const asked = (client !== undefined && client !== false) || (read !== undefined && read !== false);
    return asked || isNextRuntime() ? { cache: 'no-store' } : {};
  }
  if (read === false || (read === undefined && client === false)) {
    return {};
  }
  const configured = client === false ? read : read === undefined ? client : { ...client, ...read };
  if (configured === undefined && !isNextRuntime()) {
    return {};
  }
  if (pinned && read?.cache === undefined) {
    return { cache: 'force-cache', next: { tags } };
  }
  const cache = configured?.cache;
  const revalidate = configured?.revalidate;
  return {
    ...(cache === undefined ? {} : { cache }),
    next: { tags, ...(revalidate === undefined ? {} : { revalidate }) },
  };
};
