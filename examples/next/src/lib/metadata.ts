import type { SeoResolved } from '@shapio/client';
import type { Metadata } from 'next';
import { siteUrl } from './config';
import { seoHead, type SeoHead } from './seo';
import { getSite } from './shapio';
import { DEFAULT_LOCALE, type Locale } from './site';

type PageMetadataInput = {
  /** The page's own title; entry pages pass their SEO fields too, which win. */
  title: string;
  /** The entry's SEO fields, read with `seo=resolved`. */
  seo?: SeoResolved | null;
  type?: SeoHead['type'];
  locale: Locale;
  /** This page's path, e.g. `/en/articles/x/` (the canonical URL with SITE_URL). */
  path: string;
};

/** Next's metadata from the SEO head: `title.absolute`, as the title already went through the site's template. */
export const toMetadata = (head: SeoHead): Metadata => {
  const images = head.image
    ? [
        {
          url: head.image.url,
          ...(head.image.width ? { width: head.image.width } : {}),
          ...(head.image.height ? { height: head.image.height } : {}),
          ...(head.image.alt ? { alt: head.image.alt } : {}),
        },
      ]
    : undefined;
  return {
    title: { absolute: head.title },
    ...(head.description ? { description: head.description } : {}),
    ...(head.canonical ? { alternates: { canonical: head.canonical } } : {}),
    ...(head.noindex ? { robots: { index: false } } : {}),
    openGraph: {
      type: head.type,
      title: head.title,
      locale: head.locale,
      ...(head.siteName ? { siteName: head.siteName } : {}),
      ...(head.description ? { description: head.description } : {}),
      ...(head.canonical ? { url: head.canonical } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: head.image ? 'summary_large_image' : 'summary',
      title: head.title,
      ...(head.twitterHandle ? { site: head.twitterHandle } : {}),
      ...(head.description ? { description: head.description } : {}),
      ...(images ? { images } : {}),
    },
  };
};

/** A page's metadata: the entry's SEO fields over the site's SEO defaults (`GET /api/site`). */
export const pageMetadata = async (input: PageMetadataInput): Promise<Metadata> =>
  toMetadata(
    seoHead({
      seo: input.seo ?? null,
      site: await getSite(),
      locale: input.locale,
      localeChain: [input.locale, DEFAULT_LOCALE],
      title: input.title,
      path: input.path,
      siteUrl: siteUrl(),
      ...(input.type ? { type: input.type } : {}),
    }),
  );
