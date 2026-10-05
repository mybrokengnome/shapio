import type { SeoLocaleDefaults } from '@shapio/schema/seo';

/** A media asset as the delivery API returns it (media fields, the site's default image). */
export type DeliveryAsset = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  caption: string | null;
  focalPoint: { x: number; y: number } | null;
  url: string;
  /** Null for public assets (always, for the site's default image). */
  urlExpiresAt: string | null;
  variants: Array<{
    name: string;
    width: number | null;
    height: number | null;
    format: string;
    mimeType: string;
    url: string;
  }>;
};

/** The built-in SEO component as delivered by default (`?seo=raw`): what the entry stores. */
export type SeoFields = {
  title: string | null;
  description: string | null;
  image: DeliveryAsset | null;
  canonical: string | null;
  noindex: boolean | null;
};

/**
 * The same field with `?seo=resolved` (or `resolveSeo`): the title through the site's template (the entry's
 * own title when the SEO title is empty), description and image from the site's defaults when empty,
 * `noindex` a boolean. `canonical` stays the entry's value or null: the site builds its own from its URL.
 */
export type SeoResolved = Omit<SeoFields, 'noindex'> & { noindex: boolean };

/** `GET /api/site`: the request's site and its SEO defaults (texts per locale, the default image). */
export type DeliverySite = {
  key: string;
  name: string;
  seo: {
    locales: Record<string, SeoLocaleDefaults>;
    twitterHandle: string | null;
    image: DeliveryAsset | null;
  };
};
