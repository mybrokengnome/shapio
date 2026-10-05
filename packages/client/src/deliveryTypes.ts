import type { ContentListQuery } from './admin/contentTypes.js';

/**
 * The delivery API (`/api/content/:routeKey`): published content as sites and apps read it. `routeKey` is a
 * collection's plural API ID (`articles`) or a singleton's API ID (`homepage`).
 */
/**
 * How rich-text fields come back: `json` (the server's default) the stored document `{ format, version, doc }`,
 * `html` `{ format, version, html }` with sanitized HTML rendered on the server, `both` the document and `html`.
 */
export type RichTextMode = 'json' | 'html' | 'both';

/**
 * How SEO fields come back: `raw` (the default) as stored, `resolved` merged with the site's SEO defaults
 * (`SeoResolved`). `resolved` needs an SEO field on the model; a pinned snapshot uses today's defaults.
 */
export type SeoMode = 'raw' | 'resolved';

export type DeliveryListQuery = Omit<ContentListQuery, 'status' | 'author'> & {
  /** Read the publication snapshot N (`GET /api/snapshots/current` gives the newest) instead of now. */
  snapshot?: number;
  /** The shape of rich-text fields (`json` when absent). */
  richText?: RichTextMode;
  /** SEO fields as stored or with the site's defaults (`raw` when absent). */
  seo?: SeoMode;
};

export type DeliveryGetQuery = Pick<
  DeliveryListQuery,
  'locale' | 'fields' | 'populate' | 'snapshot' | 'richText' | 'seo'
>;

export type DeliveryMeta = {
  locale: string;
  snapshot: number;
  /** Drafts mode reads only (`publicationState=draft`); published responses carry no such member. */
  publicationState?: 'draft';
};

export type DeliveryPagination = { page: number; pageSize: number; total: number; pageCount: number };

export type DeliveryList<T = Record<string, unknown>> = {
  data: T[];
  meta: DeliveryMeta & { pagination: DeliveryPagination };
};

export type DeliveryItem<T = Record<string, unknown>> = { data: T; meta: DeliveryMeta };
