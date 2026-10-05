<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import RichText from '#lib/components/RichText.svelte';
  import type { PageProps } from './$types';

  /** The singleton page: the siteSettings entry's colophon, one per locale (loaded by the locale layout). */
  let { data }: PageProps = $props();
</script>

<Seo title={data.strings.colophon} site={data.site} locale={data.locale} siteUrl={data.siteUrl} />

<h1 class="page-title">{data.strings.colophon}</h1>
{#if data.settings?.tagline}
  <p class="lead">{data.settings.tagline}</p>
{/if}
<RichText value={data.settings?.colophon ?? null} />
