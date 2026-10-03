<script lang="ts">
  import { page } from '$app/state';
  import '#lib/site.css';
  import { articlesPath, colophonPath, HOME_SLUG, otherLocale, pagePath, switchLocale } from '#lib/site.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  const other = $derived(otherLocale(data.locale));
  // The name, tagline and footer come from the siteSettings singleton (built-in strings until it is published).
  const siteName = $derived(data.settings?.siteName ?? data.strings.siteName);
</script>

<a class="skip" href="#content">{data.strings.skipToContent}</a>
<header class="site-header">
  <a class="brand" href={pagePath(data.locale, HOME_SLUG)}>{siteName}</a>
  {#if data.settings?.tagline}
    <p class="tagline">{data.settings.tagline}</p>
  {/if}
  <nav aria-label="Main">
    <a href={articlesPath(data.locale)}>{data.strings.articles}</a>
    <a href={colophonPath(data.locale)}>{data.strings.colophon}</a>
    <a href={switchLocale(page.url.pathname, other)} hreflang={other} lang={other}>{data.strings.switchTo}</a>
  </nav>
</header>
<main id="content">
  {@render children()}
</main>
<footer class="site-footer">
  <p>{siteName} · {data.settings?.footer ?? data.strings.footer} · SvelteKit</p>
</footer>
<!-- Visual editing (@shapio/visual) plugs in here: its script and the data-shapio attributes on content arrive
     with Shapio's visual-editing SDK, together with draft preview. -->
