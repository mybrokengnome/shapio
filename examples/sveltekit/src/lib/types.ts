/**
 * Content as the Shapio delivery API returns it for the starter's models (shapio/). Delivery
 * entries are flat: system attributes next to the fields, keyed by API key. Media fields are asset views,
 * rich text carries the JSON document plus a sanitised `html` rendering, populated relations are entries.
 */
export type MediaVariant = {
  name: string;
  width: number | null;
  height: number | null;
  format: string;
  mimeType: string;
  url: string;
};

export type Media = {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
  url: string;
  variants: MediaVariant[];
};

/** Rich text as delivery returns it with `richText=html`: sanitized HTML rendered from the document. */
export type RichText = { format: 'shapio-richtext'; version: number; html: string };

type EntryBase = {
  id: string;
  /** The locale that served the entry (differs from the requested one on fallback). */
  locale: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type Feature = { title: string; description: string | null };

export type HeroSection = {
  __component: 'hero';
  heading: string;
  subheading: string | null;
  image: Media | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};
export type FeatureGridSection = { __component: 'featureGrid'; heading: string | null; features: Feature[] };
export type GallerySection = { __component: 'gallery'; heading: string | null; images: Media[] };
export type CallToActionSection = {
  __component: 'callToAction';
  heading: string;
  text: string | null;
  buttonLabel: string;
  buttonUrl: string;
};
export type Section = HeroSection | FeatureGridSection | GallerySection | CallToActionSection;

export type Page = EntryBase & {
  title: string;
  slug: string;
  description: string | null;
  sections: Section[];
};

export type Author = EntryBase & { name: string; bio: string | null; avatar: Media | null };

export type Article = EntryBase & {
  title: string;
  slug: string;
  excerpt: string | null;
  body: RichText | null;
  cover: Media | null;
  /** Populated (`populate=author`) or just the ID; null when the author is not published. */
  author: Author | string | null;
  publishedOn: string;
};

/** The `siteSettings` singleton: one entry per site, read by its API ID. */
export type SiteSettings = EntryBase & {
  siteName: string;
  tagline: string | null;
  footer: string | null;
  colophon: RichText | null;
};

export type DeliveryList<T> = {
  data: T[];
  meta: {
    locale: string;
    snapshot: number;
    pagination: { page: number; pageSize: number; total: number; pageCount: number };
  };
};

export type DeliveryItem<T> = { data: T; meta: { locale: string; snapshot: number } };
