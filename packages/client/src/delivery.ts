import { toContentQueryString } from './admin/contentQuery.js';
import type { DeliveryGetQuery, DeliveryItem, DeliveryList, DeliveryListQuery } from './deliveryTypes.js';
import type { RequestFn } from './request.js';

export const DELIVERY_PATH = '/api/content';

const routePath = (routeKey: string) => `${DELIVERY_PATH}/${encodeURIComponent(routeKey)}`;

/** The content query string plus `snapshot` and `richText`, which only delivery reads take. */
const deliveryQueryString = ({ snapshot, richText, ...query }: DeliveryListQuery): string => {
  const extra = [
    ...(snapshot === undefined ? [] : [`snapshot=${encodeURIComponent(String(snapshot))}`]),
    ...(richText === undefined ? [] : [`richText=${encodeURIComponent(richText)}`]),
  ];
  const base = toContentQueryString(query);
  if (extra.length === 0) {
    return base;
  }
  return base ? `${base}&${extra.join('&')}` : `?${extra.join('&')}`;
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
