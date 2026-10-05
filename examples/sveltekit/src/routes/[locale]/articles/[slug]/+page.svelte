<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import ArticleView from '#lib/components/ArticleView.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Seo title={data.article.title} seo={data.article.seo} type="article" site={data.site} locale={data.locale} siteUrl={data.siteUrl} />

<ArticleView article={data.article} locale={data.locale} strings={data.strings} />
