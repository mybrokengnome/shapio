<script lang="ts">
  import { initVisualEditing } from '@shapio/visual';
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import ArticleView from '#lib/components/ArticleView.svelte';
  import Sections from '#lib/components/Sections.svelte';
  import '#lib/site.css';
  import { loadDraft, parsePreviewUrl, type PreviewDraft } from '#lib/preview.ts';
  import { DEFAULT_LOCALE, stringsFor, type Locale } from '#lib/site.ts';
  import type { PageProps } from './$types';

  /**
   * `/preview/?model=…&id=…&locale=…#token=…`: the draft Shapio's preview URL points at, read in the browser
   * with the preview token (src/lib/preview.ts) and rendered with the published pages' components. Inside
   * Shapio's preview pane, @shapio/visual turns on visual editing and re-loads the draft after each save.
   */
  let { data }: PageProps = $props();
  let locale: Locale = $state(DEFAULT_LOCALE);
  let status: 'loading' | 'incomplete' | 'failed' | 'ready' = $state('loading');
  let message = $state('');
  let draft: PreviewDraft | undefined = $state();
  const strings = $derived(stringsFor(locale));

  onMount(() => {
    const request = parsePreviewUrl(new URL(window.location.href));
    // The token must not linger in the address bar, history or a shared screenshot.
    replaceState(`${window.location.pathname}${window.location.search}`, {});
    if (!request) {
      status = 'incomplete';
      return undefined;
    }
    locale = request.locale;
    document.documentElement.lang = request.locale;
    const load = async () => {
      try {
        draft = await loadDraft(data.shapioUrl, request);
        status = 'ready';
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
        status = 'failed';
      }
    };
    void load();
    return initVisualEditing({ origin: data.shapioUrl, onRefresh: load });
  });
</script>

<svelte:head>
  <title>Preview</title>
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="preview-banner" role="status">{strings.previewBanner}</div>
<main id="content" lang={locale}>
  {#if status === 'loading'}
    <p>{strings.previewLoading}</p>
  {:else if status === 'incomplete'}
    <p>{strings.previewIncomplete}</p>
  {:else if status === 'failed'}
    <p>{strings.previewFailed}: {message}</p>
  {:else if draft?.modelKey === 'pages'}
    <Sections page={draft.entry} />
  {:else if draft?.modelKey === 'articles'}
    <ArticleView article={draft.entry} locale={draft.locale} {strings} />
  {/if}
</main>
