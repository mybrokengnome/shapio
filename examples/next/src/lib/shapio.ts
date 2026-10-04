import { createClient, ShapioApiError, type DeliveryListQuery } from '@shapio/client';
import { deliveryToken, shapioUrl, siteKey } from './config';
import { liveSnapshot } from './liveSnapshot';
import type { Locale } from './site';
import type { Article, Page, SiteSettings } from './types';

/**
 * The site's read side: Shapio's delivery API through `@shapio/client`, at one publication snapshot. Next
 * renders pages in several worker processes, so the snapshot is pinned once in next.config.ts (it sets
 * SHAPIO_SNAPSHOT for the whole build) and every request here sends it. Under `next start`, /api/revalidate
 * moves that snapshot forward (src/lib/liveSnapshot.ts).
 */
const PAGE_SIZE = 100;

/** Delivery addresses a collection by its plural API ID, a singleton by its API ID. */
const PAGES = 'pages';
const ARTICLES = 'articles';
const SITE_SETTINGS = 'siteSettings';

/** The fields each read renders (`fields=`): smaller responses, and accurate field usage in Shapio. */
const PAGE_FIELDS = ['title', 'slug', 'description', 'sections'];
const ARTICLE_FIELDS = ['title', 'slug', 'excerpt', 'body', 'cover', 'author', 'publishedOn'];
const SITE_SETTINGS_FIELDS = ['siteName', 'tagline', 'footer', 'colophon'];

export const createShapio = () =>
  createClient({ baseUrl: shapioUrl(), token: deliveryToken(), site: siteKey() });

let client: ReturnType<typeof createShapio> | undefined;
export const shapio = () => (client ??= createShapio());

const snapshot = liveSnapshot;

/** Every published entry of a collection in one locale, page by page, at the pinned snapshot. */
const listAll = async <T>(routeKey: string, query: DeliveryListQuery): Promise<T[]> => {
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().delivery.list<T>(routeKey, {
      ...query,
      // The site renders the server's sanitized HTML, so it asks for that instead of the JSON document.
      richText: 'html',
      snapshot: snapshot(),
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
      snapshot: snapshot(),
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
