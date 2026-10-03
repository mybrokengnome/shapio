import type { ContentListQuery } from './admin/contentTypes.js';

/**
 * The delivery API (`/api/content/:routeKey`): published content as sites and apps read it. `routeKey` is a
 * collection's plural API ID (`articles`) or a singleton's API ID (`homepage`).
 */
export type DeliveryListQuery = Omit<ContentListQuery, 'status' | 'author'> & {
  /** Read the publication snapshot N (`GET /api/snapshots/current` gives the newest) instead of now. */
  snapshot?: number;
};

export type DeliveryGetQuery = Pick<DeliveryListQuery, 'locale' | 'fields' | 'populate' | 'snapshot'>;

export type DeliveryMeta = { locale: string; snapshot: number };

export type DeliveryPagination = { page: number; pageSize: number; total: number; pageCount: number };

export type DeliveryList<T = Record<string, unknown>> = {
  data: T[];
  meta: DeliveryMeta & { pagination: DeliveryPagination };
};

export type DeliveryItem<T = Record<string, unknown>> = { data: T; meta: DeliveryMeta };
