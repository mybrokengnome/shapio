import { initVisualEditing } from '@shapio/visual';
import { loadPreview, parsePreviewUrl, type PreviewRequest } from '../lib/preview.js';
import { stringsFor } from '../lib/site.js';

/**
 * The preview page's browser side: read the request, drop the token from the address bar, render the draft.
 * Inside Shapio's preview pane (`?shapio-visual=1`), @shapio/visual turns on visual editing: a click on a
 * field focuses it in Shapio, and each save there re-renders the draft here (with the token kept in memory,
 * since the address bar no longer has it).
 */
const show = (element: HTMLElement | null, text: string) => {
  if (element) {
    element.textContent = text;
  }
};

const render = async (shapioUrl: string, request: PreviewRequest, content: HTMLElement) => {
  const strings = stringsFor(request.locale);
  try {
    const { html, title } = await loadPreview(shapioUrl, request);
    document.title = `${title} · ${strings.siteName}`;
    content.innerHTML = html;
  } catch (error) {
    show(content, `${strings.previewFailed}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const run = async () => {
  const content = document.getElementById('content');
  const banner = document.getElementById('preview-banner');
  const request = parsePreviewUrl(new URL(window.location.href));
  // The token must not linger in the address bar, history or a shared screenshot.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  if (!request || !content) {
    show(content, 'This preview link is incomplete.');
    return;
  }
  const strings = stringsFor(request.locale);
  const shapioUrl = document.body.dataset.shapioUrl ?? '';
  document.documentElement.lang = request.locale;
  show(banner, strings.previewBanner);
  show(content, strings.previewLoading);
  await render(shapioUrl, request, content);
  initVisualEditing({ origin: shapioUrl, onRefresh: () => render(shapioUrl, request, content) });
};

void run();
