<script lang="ts">
  import ArticleView from '#lib/components/ArticleView.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.article.title} · {data.settings?.siteName ?? data.strings.siteName}</title>
  {#if data.article.excerpt}
    <meta name="description" content={data.article.excerpt} />
  {/if}
</svelte:head>

<ArticleView article={data.article} locale={data.locale} strings={data.strings} />
