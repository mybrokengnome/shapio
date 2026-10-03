<script lang="ts">
  import type { FeatureGridSection } from '../types';

  type Props = { section: FeatureGridSection };
  let { section }: Props = $props();
</script>

<section class="features">
  {#if section.heading}
    <h2>{section.heading}</h2>
  {/if}
  <ul class="feature-grid">
    {#each section.features as feature (feature.title)}
      <li>
        <h3>{feature.title}</h3>
        {#if feature.description}
          <p>{feature.description}</p>
        {/if}
      </li>
    {/each}
  </ul>
</section>
