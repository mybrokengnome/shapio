<script lang="ts">
  import type { DeliverySite, SeoResolved } from '@shapio/client';
  import { page } from '$app/state';
  import { seoHead, type SeoHead } from '../seo';
  import { DEFAULT_LOCALE } from '../site';

  /**
   * The page's <head>: title, description, Open Graph, Twitter card, canonical and robots, from the entry's SEO
   * fields (read with `seo=resolved`) over the site's SEO defaults. Pages without an entry pass their title only.
   */
  type Props = {
    title: string;
    seo?: SeoResolved | null;
    type?: SeoHead['type'];
    site: DeliverySite | null;
    locale: string;
    siteUrl: string | null;
    noindex?: boolean;
  };
  let { title, seo = null, type = 'website', site, locale, siteUrl, noindex = false }: Props = $props();
  const head = $derived(
    seoHead({
      seo,
      site,
      locale,
      localeChain: [locale, DEFAULT_LOCALE],
      title,
      path: page.url.pathname,
      siteUrl: siteUrl ?? undefined,
      type,
    }),
  );
</script>

<svelte:head>
  <title>{head.title}</title>
  {#if head.description}
    <meta name="description" content={head.description} />
    <meta property="og:description" content={head.description} />
    <meta name="twitter:description" content={head.description} />
  {/if}
  {#if noindex || head.noindex}
    <meta name="robots" content="noindex" />
  {/if}
  {#if head.canonical}
    <link rel="canonical" href={head.canonical} />
    <meta property="og:url" content={head.canonical} />
  {/if}
  <meta property="og:type" content={head.type} />
  <meta property="og:title" content={head.title} />
  <meta property="og:locale" content={head.locale} />
  {#if head.siteName}
    <meta property="og:site_name" content={head.siteName} />
  {/if}
  {#if head.image}
    <meta property="og:image" content={head.image.url} />
    {#if head.image.width}
      <meta property="og:image:width" content={String(head.image.width)} />
    {/if}
    {#if head.image.height}
      <meta property="og:image:height" content={String(head.image.height)} />
    {/if}
    {#if head.image.alt}
      <meta property="og:image:alt" content={head.image.alt} />
    {/if}
    <meta name="twitter:image" content={head.image.url} />
  {/if}
  <meta name="twitter:card" content={head.image ? 'summary_large_image' : 'summary'} />
  {#if head.twitterHandle}
    <meta name="twitter:site" content={head.twitterHandle} />
  {/if}
  <meta name="twitter:title" content={head.title} />
</svelte:head>
