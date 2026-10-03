<script lang="ts">
  import type { ShapioAttributes } from '@shapio/visual';
  import { safeHref } from '../site';
  import type { HeroSection } from '../types';
  import ResponsiveImage from './ResponsiveImage.svelte';

  type Props = { section: HeroSection; isFirst: boolean; visual?: ShapioAttributes };
  let { section, isFirst, visual }: Props = $props();
</script>

<section class="hero">
  <div class="hero-text">
    <svelte:element this={isFirst ? 'h1' : 'h2'} {...visual}>{section.heading}</svelte:element>
    {#if section.subheading}
      <p class="lead">{section.subheading}</p>
    {/if}
    {#if section.ctaLabel && section.ctaUrl}
      <a class="button" href={safeHref(section.ctaUrl)}>{section.ctaLabel}</a>
    {/if}
  </div>
  {#if section.image}
    <ResponsiveImage media={section.image} sizes="(min-width: 64rem) 50vw, 100vw" eager={isFirst} class="hero-image" />
  {/if}
</section>
