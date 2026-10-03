<script lang="ts">
  import Sections from '#lib/components/Sections.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.page.title} · {data.settings?.siteName ?? data.strings.siteName}</title>
  {#if data.page.description}
    <meta name="description" content={data.page.description} />
  {/if}
</svelte:head>

<Sections page={data.page} />
