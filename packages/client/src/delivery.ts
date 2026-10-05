import { toContentQueryString } from './admin/contentQuery.js';
import type { DeliveryGetQuery, DeliveryItem, DeliveryList, DeliveryListQuery } from './deliveryTypes.js';
import {
  nextFetchInit,
  shapioTags,
  type DeliveryCacheContext,
  type DeliveryReadOptions,
} from './nextCache.js';
import type { RequestFn } from './request.js';

export const DELIVERY_PATH = '/api/content';

const routePath = (routeKey: string) => `${DELIVERY_PATH}/${encodeURIComponent(routeKey)}`;

/**
 * The content query string plus `snapshot`, `richText` and `seo`, which only delivery reads take, and
 * `publicationState=draft` in drafts mode.
 */
const deliveryQueryString = (
  { snapshot, richText, seo, ...query }: DeliveryListQuery,
  drafts: boolean,
): string => {
  const extra = [
    ...(snapshot === undefined ? [] : [`snapshot=${encodeURIComponent(String(snapshot))}`]),
    ...(richText === undefined ? [] : [`richText=${encodeURIComponent(richText)}`]),
    ...(seo === undefined ? [] : [`seo=${encodeURIComponent(seo)}`]),
    ...(drafts ? ['publicationState=draft'] : []),
  ];
  const base = toContentQueryString(query);
  if (extra.length === 0) {
    return base;
  }
  return base ? `${base}&${extra.join('&')}` : `?${extra.join('&')}`;
};

/** Drafts cannot be pinned: the server refuses `snapshot` with drafts, and so does the client, before sending. */
const draftsPinned = () =>
  Promise.reject(
    new Error(
      'Drafts mode reads saved drafts, which have no publication snapshot: leave `snapshot` out when the client has `drafts: true`',
    ),
  );

/**
 * Published content, typed by the caller (`delivery.list<Article>('articles', { locale: 'fr', snapshot })`).
 * A collection is read with `list` (a page) and `get` (one entry); a singleton with `singleton`. Each read
 * takes Next.js cache options last and is tagged for `revalidateTag` (nextCache.ts): lists and singletons with
 * the site and model tags, `get` with the entry's tag too. In drafts mode (`drafts: true`) every read asks for
 * drafts (`publicationState=draft`), is never cached or tagged under Next, and refuses a pinned snapshot.
 */
export const createDeliveryApi = (request: RequestFn, cacheContext: DeliveryCacheContext) => {
  const { drafts } = cacheContext;
  const fetchInit = (tags: string[], query: DeliveryGetQuery, { next }: DeliveryReadOptions) =>
    nextFetchInit({
      client: cacheContext.next,
      read: next,
      tags,
      pinned: query.snapshot !== undefined,
      drafts,
    });
  const read = <R>(path: string, tags: string[], query: DeliveryListQuery, options: DeliveryReadOptions) =>
    drafts && query.snapshot !== undefined
      ? draftsPinned()
      : request<R>(`${path}${deliveryQueryString(query, drafts)}`, fetchInit(tags, query, options));
  const siteTag = shapioTags.site(cacheContext.site);
  return {
    list: <T = Record<string, unknown>>(
      routeKey: string,
      query: DeliveryListQuery = {},
      options: DeliveryReadOptions = {},
    ) => read<DeliveryList<T>>(routePath(routeKey), [siteTag, shapioTags.model(routeKey)], query, options),
    singleton: <T = Record<string, unknown>>(
      apiKey: string,
      query: DeliveryGetQuery = {},
      options: DeliveryReadOptions = {},
    ) => read<DeliveryItem<T>>(routePath(apiKey), [siteTag, shapioTags.model(apiKey)], query, options),
    get: <T = Record<string, unknown>>(
      routeKey: string,
      id: string,
      query: DeliveryGetQuery = {},
      options: DeliveryReadOptions = {},
    ) =>
      read<DeliveryItem<T>>(
        `${routePath(routeKey)}/${encodeURIComponent(id)}`,
        [siteTag, shapioTags.model(routeKey), shapioTags.entry(routeKey, id)],
        query,
        options,
      ),
  };
};

export type DeliveryApi = ReturnType<typeof createDeliveryApi>;
