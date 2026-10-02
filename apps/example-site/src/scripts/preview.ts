import { loadPreview, parsePreviewUrl } from '../lib/preview.js';
import { stringsFor } from '../lib/site.js';

/** The preview page's browser side: read the request, drop the token from the address bar, render the draft. */
const show = (element: HTMLElement | null, text: string) => {
  if (element) {
    element.textContent = text;
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
  document.documentElement.lang = request.locale;
  show(banner, strings.previewBanner);
  show(content, strings.previewLoading);
  try {
    const { html, title } = await loadPreview(document.body.dataset.shapioUrl ?? '', request);
    document.title = `${title} · ${strings.siteName}`;
    content.innerHTML = html;
  } catch (error) {
    show(content, `${strings.previewFailed}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

void run();
