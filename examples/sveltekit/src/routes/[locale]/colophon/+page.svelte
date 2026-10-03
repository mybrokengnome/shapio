<script lang="ts">
  import RichText from '#lib/components/RichText.svelte';
  import type { PageProps } from './$types';

  /** The singleton page: the siteSettings entry's colophon, one per locale (loaded by the locale layout). */
  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.strings.colophon} · {data.settings?.siteName ?? data.strings.siteName}</title>
</svelte:head>

<h1 class="page-title">{data.strings.colophon}</h1>
{#if data.settings?.tagline}
  <p class="lead">{data.settings.tagline}</p>
{/if}
<RichText value={data.settings?.colophon ?? null} />
