<script lang="ts">
  import { articlePath, type Strings } from '../site';
  import type { Article } from '../types';
  import Byline from './Byline.svelte';
  import ResponsiveImage from './ResponsiveImage.svelte';

  type Props = { article: Article; locale: string; strings: Strings };
  let { article, locale, strings }: Props = $props();
</script>

<li class="card">
  {#if article.cover}
    <ResponsiveImage media={article.cover} sizes="(min-width: 48rem) 33vw, 100vw" />
  {/if}
  <h2><a href={articlePath(locale, article.slug)}>{article.title}</a></h2>
  <Byline {article} {locale} {strings} />
  {#if article.excerpt}
    <p>{article.excerpt}</p>
  {/if}
</li>
