import {
  applyTitleTemplate,
  seoDefaultsForLocale,
  type DeliveryAsset,
  type DeliverySite,
  type SeoResolved,
} from '@shapio/client';

/**
 * What a page puts in its <head> (title, description, Open Graph, Twitter card, canonical, robots), from an
 * entry's SEO fields read with `?seo=resolved` and the site's SEO defaults (`GET /api/site`). Pages without an
 * entry (listings, the colophon) pass their own title: it goes through the site's title template here.
 */
export type SeoHead = {
  title: string;
  description: string | null;
  image: { url: string; width: number | null; height: number | null; alt: string | null } | null;
  /** The entry's canonical URL, else this page's URL on SITE_URL; null when neither is known. */
  canonical: string | null;
  noindex: boolean;
  siteName: string | null;
  twitterHandle: string | null;
  /** `article` for articles, `website` for everything else (`og:type`). */
  type: 'website' | 'article';
  /** `og:locale`, e.g. `en` or `fr`. */
  locale: string;
};

export type SeoHeadInput = {
  /** The entry's resolved SEO fields; absent on pages without an entry. */
  seo?: SeoResolved | null;
  /** The site and its defaults; null when it could not be read (the page still renders a title). */
  site: DeliverySite | null;
  locale: string;
  /** The locales whose defaults apply, in order (the page's locale, then the default one). */
  localeChain: readonly string[];
  /** The page's own title (entry pages: used only when the entry has no SEO fields). */
  title: string;
  /** This page's path, e.g. `/en/articles/x/`; with `siteUrl` it makes the canonical URL. */
  path: string;
  siteUrl?: string | undefined;
  type?: SeoHead['type'];
};

const imageOf = (asset: DeliveryAsset | null | undefined): SeoHead['image'] =>
  asset ? { url: asset.url, width: asset.width, height: asset.height, alt: asset.alt } : null;

const canonicalOf = (own: string | null | undefined, path: string, siteUrl: string | undefined) => {
  if (own) {
    return own;
  }
  return siteUrl ? new URL(path, siteUrl).href : null;
};

export const seoHead = (input: SeoHeadInput): SeoHead => {
  const defaults = seoDefaultsForLocale(input.site?.seo ?? { locales: {} }, input.localeChain);
  const { seo } = input;
  return {
    title: seo?.title ?? applyTitleTemplate(input.title, defaults.titleTemplate),
    description: seo?.description ?? defaults.description ?? null,
    image: imageOf(seo?.image ?? input.site?.seo.image),
    canonical: canonicalOf(seo?.canonical, input.path, input.siteUrl),
    noindex: seo?.noindex ?? false,
    siteName: defaults.siteName ?? null,
    twitterHandle: input.site?.seo.twitterHandle ?? null,
    type: input.type ?? 'website',
    locale: input.locale,
  };
};
