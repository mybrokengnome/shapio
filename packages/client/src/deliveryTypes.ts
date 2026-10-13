import type { ContentListQuery } from './admin/contentTypes.js';

/**
 * The delivery API (`/api/content/:routeKey`): published content as sites and apps read it. `routeKey` is a
 * collection's plural API ID (`articles`) or a singleton's API ID (`homepage`); a type that extends another is
 * nested under its ancestors' plural API IDs (`posts/guides`).
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
  /** The publication snapshot this response reflects; null in drafts mode, which cannot be pinned. */
  snapshot: number | null;
  /** Drafts mode reads only (`publicationState=draft`); published responses carry no such member. */
  publicationState?: 'draft';
};

export type DeliveryPagination = { page: number; pageSize: number; total: number; pageCount: number };

/**
 * What every delivery entry carries besides its fields. `__model` is the singular API ID of the entry's own
 * model: in a parent's list (`/api/content/posts`) each row is one kind (`post`, `guide`) in its
 * own shape, so switch on `__model` the way a dynamic zone item is read by `__component`.
 */
export type DeliveryEntryAttributes = { __model: string };

/** A delivery entry: the caller's type with the attributes every entry carries. */
export type DeliveryEntry<T = Record<string, unknown>> = T & DeliveryEntryAttributes;

export type DeliveryList<T = Record<string, unknown>> = {
  data: Array<DeliveryEntry<T>>;
  meta: DeliveryMeta & { pagination: DeliveryPagination };
};

export type DeliveryItem<T = Record<string, unknown>> = { data: DeliveryEntry<T>; meta: DeliveryMeta };
