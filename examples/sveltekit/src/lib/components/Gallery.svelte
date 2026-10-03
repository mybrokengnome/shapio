<script lang="ts">
  import type { GallerySection } from '../types';
  import ResponsiveImage from './ResponsiveImage.svelte';

  type Props = { section: GallerySection };
  let { section }: Props = $props();
</script>

<section class="gallery">
  {#if section.heading}
    <h2>{section.heading}</h2>
  {/if}
  <ul class="gallery-grid">
    {#each section.images as image (image.id)}
      <li>
        <figure>
          <ResponsiveImage media={image} sizes="(min-width: 48rem) 33vw, 100vw" />
          {#if image.caption}
            <figcaption>{image.caption}</figcaption>
          {/if}
        </figure>
      </li>
    {/each}
  </ul>
</section>
