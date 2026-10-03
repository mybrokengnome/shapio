<script lang="ts">
  import { shapioAttr } from '@shapio/visual';
  import type { Page } from '../types';
  import CallToAction from './CallToAction.svelte';
  import FeatureGrid from './FeatureGrid.svelte';
  import Gallery from './Gallery.svelte';
  import Hero from './Hero.svelte';

  /** A page's dynamic zone. The page title is the heading when the page does not open with a hero. */
  type Props = { page: Pick<Page, 'id' | 'title' | 'sections' | 'locale'> };
  let { page }: Props = $props();
</script>

<div lang={page.locale}>
  {#if page.sections[0]?.__component !== 'hero'}
    <h1 class="page-title" {...shapioAttr(page, 'title')}>{page.title}</h1>
  {/if}
  {#each page.sections as section, index (`${section.__component}-${index}`)}
    {#if section.__component === 'hero'}
      <Hero {section} isFirst={index === 0} visual={shapioAttr(page, `sections/${index}/heading`)} />
    {:else if section.__component === 'featureGrid'}
      <FeatureGrid {section} />
    {:else if section.__component === 'gallery'}
      <Gallery {section} />
    {:else if section.__component === 'callToAction'}
      <CallToAction {section} />
    {/if}
    <!-- Any other section type (added in Shapio after the last deploy) is skipped. -->
  {/each}
</div>
