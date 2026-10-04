import { createClient, ShapioApiError, type DeliveryListQuery } from '@shapio/client';
import type { Locale } from '../site';
import type { Article, Page, SiteSettings } from '../types';
import { configuredSnapshot, deliveryToken, shapioUrl, siteKey } from './config';

/**
 * The site's read side: Shapio's delivery API through `@shapio/client`, pinned to one publication snapshot
 * for the whole build. The snapshot is read once, when prerendering starts (or taken from SHAPIO_SNAPSHOT),
 * and sent with every request, so a publish during the build never yields a site that mixes old and new.
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

const createShapio = () => createClient({ baseUrl: shapioUrl(), token: deliveryToken(), site: siteKey() });

let client: ReturnType<typeof createShapio> | undefined;
const shapio = () => (client ??= createShapio());

let pinned: Promise<number> | undefined;

/** The snapshot every request of this build reads. */
const snapshot = (): Promise<number> =>
  (pinned ??= (async () => configuredSnapshot() ?? (await shapio().snapshots.current()).snapshot)());

/** Each collection is read once per locale, however many pages render from it. */
const memo = new Map<string, Promise<unknown>>();
const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
  let value = memo.get(key) as Promise<T> | undefined;
  if (!value) {
    value = read();
    memo.set(key, value);
  }
  return value;
};

/** Every published entry of a collection in one locale, page by page, at the pinned snapshot. */
const listAll = async <T>(routeKey: string, query: DeliveryListQuery): Promise<T[]> => {
  const entries: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await shapio().delivery.list<T>(routeKey, {
      ...query,
      // The site renders the server's sanitized HTML, so it asks for that instead of the JSON document.
      richText: 'html',
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
