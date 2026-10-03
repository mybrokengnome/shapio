<script lang="ts">
  import { authorOf } from '../articles';
  import type { Strings } from '../site';
  import type { Article } from '../types';
  import Byline from './Byline.svelte';
  import ResponsiveImage from './ResponsiveImage.svelte';
  import RichText from './RichText.svelte';

  type Props = { article: Article; locale: string; strings: Strings };
  let { article, locale, strings }: Props = $props();
  const author = $derived(authorOf(article));
</script>

<article class="article" lang={article.locale}>
  <header>
    <h1>{article.title}</h1>
    <Byline {article} {locale} {strings} />
  </header>
  {#if article.cover}
    <ResponsiveImage media={article.cover} sizes="(min-width: 48rem) 48rem, 100vw" eager class="cover" />
  {/if}
  <RichText value={article.body} />
  {#if author}
    <aside class="author">
      {#if author.avatar}
        <ResponsiveImage media={author.avatar} sizes="4rem" class="avatar" />
      {/if}
      <div>
        <p class="author-name">{author.name}</p>
        {#if author.bio}
          <p>{author.bio}</p>
        {/if}
      </div>
    </aside>
  {/if}
</article>
