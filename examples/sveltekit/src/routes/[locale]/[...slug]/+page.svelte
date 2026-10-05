<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import Sections from '#lib/components/Sections.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Seo title={data.page.title} seo={data.page.seo} site={data.site} locale={data.locale} siteUrl={data.siteUrl} />

<Sections page={data.page} />
