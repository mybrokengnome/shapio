import { createClient, ShapioApiError, type DeliveryListQuery } from '@shapio/client';
import { configuredSnapshot, deliveryToken, shapioUrl, siteKey } from './config';
import type { Locale } from './site';
import type { Article, Page, SiteSettings } from './types';

/**
 * The site's read side: Shapio's delivery API through `@shapio/client`, at one publication snapshot. Next
 * renders pages in several worker processes, so the snapshot is pinned once in next.config.ts (it sets
 * SHAPIO_SNAPSHOT for the whole build) and every request here sends it.
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
const shapio = () => (client ??= createShapio());

const snapshot = () => {
  const pinned = configuredSnapshot();
  if (pinned === undefined) {
    throw new Error('No pinned snapshot: next.config.ts sets SHAPIO_SNAPSHOT when `next build` starts');
  }
  return pinned;
};

/** Every published entry of a collection in one locale, page by page, at the pinned snapshot. */
const listAll = async <T>(routeKey: string, query: DeliveryListQuery): Promise<T[]> => {
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().delivery.list<T>(routeKey, {
      ...query,
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
    });
    return data;
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};
