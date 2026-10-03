<script lang="ts">
  import ArticleCard from '#lib/components/ArticleCard.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.strings.articles} · {data.settings?.siteName ?? data.strings.siteName}</title>
</svelte:head>

<h1 class="page-title">{data.strings.articles}</h1>
<ul class="cards">
  {#each data.articles as article (article.id)}
    <ArticleCard {article} locale={data.locale} strings={data.strings} />
  {/each}
</ul>
