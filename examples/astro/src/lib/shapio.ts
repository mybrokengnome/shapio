import { createClient, ShapioApiError, type DeliverySite } from '@shapio/client';
import { configuredSnapshot, deliveryToken, isDev, shapioUrl, siteKey } from './config.js';
import type { Locale } from './site.js';
import { cachedRead, cacheWindow, createSnapshotResolver } from './snapshotResolver.js';
import type { Article, DeliveryList, Page, SiteSettings } from './types.js';

/**
 * The site's read side: Shapio's delivery API through `@shapio/client`, pinned to one publication snapshot
 * for the whole build. The snapshot is read once, when the build starts (or taken from SHAPIO_SNAPSHOT), and
 * sent with every request, so a page built a minute later still shows the same moment: a publish during the
 * build never yields a site that mixes old and new content. Under `astro dev` the snapshot and the site settings
 * are read again once the last read is a second old, so a publish shows on reload (src/lib/snapshotResolver.ts).
 */
const PAGE_SIZE = 100;

/** Delivery addresses a collection by its plural API ID (`/api/content/pages`), not its API ID (`page`). */
const PAGES = 'pages';
const ARTICLES = 'articles';

/**
 * The fields each listing renders, sent as `fields=`: the response carries only these, and Shapio's field
 * usage shows exactly what the site reads (a whole-model read would count every field as used).
 */
const PAGE_FIELDS = 'title,slug,description,sections,seo';
const ARTICLE_FIELDS = 'title,slug,excerpt,body,cover,author,publishedOn,seo';

/** The `siteSettings` singleton is read by its API ID (singletons have no plural). */
const SITE_SETTINGS = 'siteSettings';
const SITE_SETTINGS_FIELDS = ['siteName', 'tagline', 'footer', 'colophon'];

let client: ReturnType<typeof createClient> | undefined;
const shapio = () =>
  (client ??= createClient({ baseUrl: shapioUrl(), token: deliveryToken(), site: siteKey() }));

let resolver: (() => Promise<number>) | undefined;

/** The snapshot every request reads: one for the whole build; in dev, the current one (re-read after 1 s). */
export const pinnedSnapshot = async (): Promise<number> => {
  const dev = isDev();
  resolver ??= createSnapshotResolver({
    dev,
    configured: configuredSnapshot(),
    current: async () => {
      const { snapshot } = await shapio().snapshots.current();
      if (!dev) {
        // Shared with any other copy of this module in the build (one value per build).
        process.env.SHAPIO_SNAPSHOT = String(snapshot);
      }
      return snapshot;
    },
  });
  return resolver();
};

const query = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();

/** Every published entry of a collection (by plural API ID) in one locale, page by page, at the pinned snapshot. */
const listAll = async <T>(
  routeKey: string,
  locale: Locale,
  extra: Record<string, string> = {},
): Promise<T[]> => {
  const snapshot = await pinnedSnapshot();
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().request<DeliveryList<T>>(
      // The site renders the server's sanitized HTML, so it asks for that instead of the JSON document, and
      // its SEO fields with the site's defaults filled in (`seo=resolved`).
      `/api/content/${routeKey}?${query({ locale, snapshot, page, pageSize: PAGE_SIZE, richText: 'html', seo: 'resolved', ...extra })}`,
    );
    entries.push(...result.data);
    if (page >= result.meta.pagination.pageCount) {
      return entries;
    }
  }
};

export const listPages = (locale: Locale) => listAll<Page>(PAGES, locale, { fields: PAGE_FIELDS });

export const listArticles = (locale: Locale) =>
  listAll<Article>(ARTICLES, locale, {
    fields: ARTICLE_FIELDS,
    populate: 'author',
    sort: 'publishedOn:desc',
  });

const readSiteSettings = async (locale: Locale): Promise<SiteSettings | null> => {
  try {
    const { data } = await shapio().delivery.singleton<SiteSettings>(SITE_SETTINGS, {
      locale,
      snapshot: await pinnedSnapshot(),
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

const settingsByLocale = new Map<Locale, () => Promise<SiteSettings | null>>();

/** The site settings singleton in one locale at the pinned snapshot; null until it is published. */
export const getSiteSettings = (locale: Locale): Promise<SiteSettings | null> => {
  let settings = settingsByLocale.get(locale);
  if (!settings) {
    settings = cachedRead(() => readSiteSettings(locale), cacheWindow(isDev()));
    settingsByLocale.set(locale, settings);
  }
  return settings();
};

const readSite = async (): Promise<DeliverySite | null> => {
  try {
    return await shapio().site.get();
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

let site: (() => Promise<DeliverySite | null>) | undefined;

/**
 * The site and its SEO defaults (name and title template per locale, default image, Twitter handle), once per
 * build (in dev, re-read after 1 s). Null when the Shapio predates them: the pages still render, with plain
 * titles.
 */
export const getSite = (): Promise<DeliverySite | null> =>
  (site ??= cachedRead(readSite, cacheWindow(isDev())))();
