<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import ArticleCard from '#lib/components/ArticleCard.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Seo title={data.strings.articles} site={data.site} locale={data.locale} siteUrl={data.siteUrl} />

<h1 class="page-title">{data.strings.articles}</h1>
<ul class="cards">
  {#each data.articles as article (article.id)}
    <ArticleCard {article} locale={data.locale} strings={data.strings} />
  {/each}
</ul>
