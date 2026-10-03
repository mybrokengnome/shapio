import { toContentQueryString } from './admin/contentQuery.js';
import type { DeliveryGetQuery, DeliveryItem, DeliveryList, DeliveryListQuery } from './deliveryTypes.js';
import type { RequestFn } from './request.js';

export const DELIVERY_PATH = '/api/content';

const routePath = (routeKey: string) => `${DELIVERY_PATH}/${encodeURIComponent(routeKey)}`;

/** The content query string plus `snapshot`, which only delivery reads take. */
const deliveryQueryString = ({ snapshot, ...query }: DeliveryListQuery): string => {
  const base = toContentQueryString(query);
  if (snapshot === undefined) {
    return base;
  }
  const pinned = `snapshot=${encodeURIComponent(String(snapshot))}`;
  return base ? `${base}&${pinned}` : `?${pinned}`;
};

/**
 * Published content, typed by the caller (`delivery.list<Article>('articles', { locale: 'fr', snapshot })`).
 * A collection is read with `list` (a page) and `get` (one entry); a singleton with `singleton`.
 */
export const createDeliveryApi = (request: RequestFn) => ({
  list: <T = Record<string, unknown>>(routeKey: string, query: DeliveryListQuery = {}) =>
    request<DeliveryList<T>>(`${routePath(routeKey)}${deliveryQueryString(query)}`),
  singleton: <T = Record<string, unknown>>(apiKey: string, query: DeliveryGetQuery = {}) =>
    request<DeliveryItem<T>>(`${routePath(apiKey)}${deliveryQueryString(query)}`),
  get: <T = Record<string, unknown>>(routeKey: string, id: string, query: DeliveryGetQuery = {}) =>
    request<DeliveryItem<T>>(`${routePath(routeKey)}/${encodeURIComponent(id)}${deliveryQueryString(query)}`),
});

export type DeliveryApi = ReturnType<typeof createDeliveryApi>;
