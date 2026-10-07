import { createClient, ShapioApiError, type DeliveryListQuery, type DeliverySite } from '@shapio/client';
import { dev } from '$app/env';
import type { Locale } from '../site';
import type { Article, Page, SiteSettings } from '../types';
import { configuredSnapshot, deliveryToken, isDraftsMode, shapioUrl, siteKey } from './config';
import { cachedRead, cacheWindow, createSnapshotResolver } from './snapshotResolver';

/**
 * The site's read side: Shapio's delivery API through `@shapio/client`, pinned to one publication snapshot
 * for the whole build. The snapshot is read once, when prerendering starts (or taken from SHAPIO_SNAPSHOT),
 * and sent with every request, so a publish during the build never yields a site that mixes old and new.
 * Under `vite dev` the snapshot and every read are reused for a second at most, so a publish shows on reload
 * (src/lib/server/snapshotResolver.ts). Drafts mode (SHAPIO_DRAFTS=true) reads saved drafts, which have no
 * snapshot: no read sends one.
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

const createShapio = () =>
  createClient({ baseUrl: shapioUrl(), token: deliveryToken(), site: siteKey(), drafts: isDraftsMode() });

let client: ReturnType<typeof createShapio> | undefined;
const shapio = () => (client ??= createShapio());

let resolver: (() => Promise<number>) | undefined;

/**
 * The snapshot every request reads: one for the whole build; in dev, the current one (re-read after 1 s); in
 * drafts mode, none (drafts cannot be pinned).
 */
const snapshot = async (): Promise<number | undefined> =>
  isDraftsMode()
    ? undefined
    : (resolver ??= createSnapshotResolver({
        dev,
        configured: configuredSnapshot(),
        current: async () => (await shapio().snapshots.current()).snapshot,
      }))();

/** Each collection is read once per locale however many pages render from it (in dev, at most 1 s apart). */
const memo = new Map<string, () => Promise<unknown>>();
const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
  let cached = memo.get(key) as (() => Promise<T>) | undefined;
  if (!cached) {
    cached = cachedRead(read, cacheWindow(dev));
    memo.set(key, cached);
  }
  return cached();
};

/**
 * Every published entry of a collection in one locale, page by page, at the pinned snapshot.
 * The defaults (server-rendered HTML, SEO fields resolved) apply unless the query overrides them: a collection
 * without SEO fields (a redirect type, say) is read with `{ seo: 'raw' }`, since Shapio refuses `seo=resolved`
 * for a model that has none.
 */
export const listAll = async <T>(routeKey: string, query: DeliveryListQuery): Promise<T[]> => {
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().delivery.list<T>(routeKey, {
      // The site renders the server's sanitized HTML, so it asks for that instead of the JSON document, and
      // its SEO fields with the site's defaults filled in.
      richText: 'html',
      seo: 'resolved',
      ...query,
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

export const listPages = (locale: Locale) =>
  once(`pages:${locale}`, () => listAll<Page>(PAGES, { locale, fields: PAGE_FIELDS }));

export const listArticles = (locale: Locale) =>
  once(`articles:${locale}`, () =>
    listAll<Article>(ARTICLES, {
      locale,
      fields: ARTICLE_FIELDS,
      populate: ['author'],
      sort: [{ field: 'publishedOn', direction: 'desc' }],
    }),
  );

/** The siteSettings singleton in one locale; null until it is published. */
export const getSiteSettings = (locale: Locale): Promise<SiteSettings | null> =>
  once(`settings:${locale}`, () => readSiteSettings(locale));

const readSiteSettings = async (locale: Locale): Promise<SiteSettings | null> => {
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
 * The site and its SEO defaults (name and title template per locale, default image, Twitter handle), once per
 * build. Null when the Shapio predates them (the pages still render, with plain titles).
 */
export const getSite = (): Promise<DeliverySite | null> =>
  once('site', async () => {
    try {
      return await shapio().site.get();
    } catch (error) {
      if (error instanceof ShapioApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });
