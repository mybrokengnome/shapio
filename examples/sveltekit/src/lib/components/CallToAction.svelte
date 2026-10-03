<script lang="ts">
  import { safeHref } from '../site';
  import type { CallToActionSection } from '../types';

  type Props = { section: CallToActionSection };
  let { section }: Props = $props();
</script>

<section class="cta">
  <h2>{section.heading}</h2>
  {#if section.text}
    <p>{section.text}</p>
  {/if}
  <a class="button" href={safeHref(section.buttonUrl)}>{section.buttonLabel}</a>
</section>
