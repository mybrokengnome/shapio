import {
  ShapioApiError,
  type DeliveryListQuery,
  type DeliverySite,
  type ShapioDeliveryClient,
} from '@shapio/client';
import { configuredSnapshot, isDevServer, isDraftsMode } from './config';
import { liveSnapshot } from './liveSnapshot';
import { createShapioClient } from './shapioClient';
import type { Locale } from './site';
import { createSnapshotResolver } from './snapshotResolver';
import type { Article, Page, SiteSettings } from './types';

/**
 * The site's read side: Shapio's delivery API (over HTTP, or in this process with SHAPIO_MODE=in-process:
 * src/lib/shapioClient.ts), at one publication snapshot. Next
 * renders pages in several worker processes, so the snapshot is pinned once in next.config.ts (it sets
 * SHAPIO_SNAPSHOT for the whole build) and every request here sends it. Under `next start`, /api/revalidate
 * moves that snapshot forward (src/lib/liveSnapshot.ts). `next dev` pins nothing: it reads the current snapshot
 * again once the last read is a second old, so a publish shows on reload (src/lib/snapshotResolver.ts). Drafts
 * mode (SHAPIO_DRAFTS=true) reads saved drafts, which have no snapshot: no read sends one, and every read is
 * fresh (the client never caches drafts).
 *
 * The client tags every read with the site, model and entry, and /api/revalidate expires the tags of what
 * changed (src/lib/revalidationTags.ts) as well as the pages. No `next: { cache }` option: reads pinned to a
 * snapshot are `force-cache` regardless, and `site.get()` (no snapshot) stays fresh on every build, since Next's
 * data cache outlives `next build`.
 */
const PAGE_SIZE = 100;

/** Delivery addresses a collection by its plural API ID, a singleton by its API ID. */
const PAGES = 'pages';
const ARTICLES = 'articles';
const SITE_SETTINGS = 'siteSettings';

/** The fields each read renders (`fields=`): smaller responses, and accurate field usage in Shapio. */
const PAGE_FIELDS = ['title', 'slug', 'description', 'sections', 'seo'];
const ARTICLE_FIELDS = ['title', 'slug', 'excerpt', 'body', 'cover', 'author', 'publishedOn', 'seo'];
const SITE_SETTINGS_FIELDS = ['siteName', 'tagline', 'footer', 'colophon'];

let client: ShapioDeliveryClient | undefined;
export const shapio = () => (client ??= createShapioClient());

let devSnapshot: (() => Promise<number>) | undefined;

/**
 * The build's snapshot (moved forward by /api/revalidate); under `next dev`, the current one; in drafts mode,
 * none (drafts cannot be pinned).
 */
const snapshot = async (): Promise<number | undefined> =>
  isDraftsMode()
    ? undefined
    : isDevServer()
      ? (devSnapshot ??= createSnapshotResolver({
          dev: true,
          configured: configuredSnapshot(),
          current: async () => (await shapio().snapshots.current()).snapshot,
        }))()
      : liveSnapshot();

/** Every published entry of a collection in one locale, page by page, at the pinned snapshot. */
const listAll = async <T>(routeKey: string, query: DeliveryListQuery): Promise<T[]> => {
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().delivery.list<T>(routeKey, {
      ...query,
      // The site renders the server's sanitized HTML, so it asks for that instead of the JSON document, and
      // its SEO fields with the site's defaults filled in.
      richText: 'html',
      seo: 'resolved',
      snapshot: await snapshot(),
      page,
      pageSize: PAGE_SIZE,
    });
    entries.push(...result.data);
    if (page >= result.meta.pagination.pageCount) {
      return entries;
    }
  }
};

export const listPages = (locale: Locale) => listAll<Page>(PAGES, { locale, fields: PAGE_FIELDS });

export const listArticles = (locale: Locale) =>
  listAll<Article>(ARTICLES, {
    locale,
    fields: ARTICLE_FIELDS,
    populate: ['author'],
    sort: [{ field: 'publishedOn', direction: 'desc' }],
  });

/** The siteSettings singleton in one locale; null until it is published. */
export const getSiteSettings = async (locale: Locale): Promise<SiteSettings | null> => {
  try {
    const { data } = await shapio().delivery.singleton<SiteSettings>(SITE_SETTINGS, {
      locale,
      snapshot: await snapshot(),
      fields: SITE_SETTINGS_FIELDS,
      richText: 'html',
    });
    return data;
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

/**
 * The site and its SEO defaults (name and title template per locale, default image, Twitter handle). Cached
 * under the site tag: a `site.updated` webhook expires it and revalidates every page, which then shows the new
 * defaults. Null when
 * the Shapio predates them (the pages still render, with plain titles).
 */
export const getSite = async (): Promise<DeliverySite | null> => {
  try {
    return await shapio().site.get();
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};
