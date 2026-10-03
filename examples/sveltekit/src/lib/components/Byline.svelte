<script lang="ts">
  import { authorOf } from '../articles';
  import { formatDate, type Strings } from '../site';
  import type { Article } from '../types';

  type Props = { article: Article; locale: string; strings: Strings };
  let { article, locale, strings }: Props = $props();
  const author = $derived(authorOf(article));
</script>

<p class="byline">
  {#if author}{strings.by} {author.name} ·
  {/if}<time datetime={article.publishedOn}>{formatDate(article.publishedOn, locale)}</time>
</p>
