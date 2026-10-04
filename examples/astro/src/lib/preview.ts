import { createClient } from '@shapio/client';
import { renderArticle, renderPage } from './render.js';
import { DEFAULT_LOCALE, stringsFor } from './site.js';
import type { Article, DeliveryItem, Page } from './types.js';

/**
 * Preview: Shapio opens `/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}` (the
 * connection's preview URL template). `{modelKey}` is the model's route key, as in the delivery and preview
 * APIs: the plural API ID of a collection (`pages`, `articles`). The token sits in the fragment, so it never reaches a server log or a
 * Referer header; it is a scoped, expiring preview token, never an admin credential. The draft is read from
 * `/api/preview/content/...` and rendered with the same functions as the published pages.
 */
export const PREVIEW_MODELS = ['pages', 'articles'] as const;

export type PreviewRequest = {
  token: string;
  modelKey: (typeof PREVIEW_MODELS)[number];
  entryId: string;
  locale: string;
};

/** Reads the request from a preview URL; undefined when something is missing or unknown. */
export const parsePreviewUrl = (url: URL): PreviewRequest | undefined => {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get('token') ?? url.searchParams.get('token');
  const modelKey = url.searchParams.get('model');
  const entryId = url.searchParams.get('id');
  if (!token || !entryId || !(PREVIEW_MODELS as readonly string[]).includes(modelKey ?? '')) {
    return undefined;
  }
  return {
    token,
    modelKey: modelKey as PreviewRequest['modelKey'],
    entryId,
    locale: url.searchParams.get('locale') ?? DEFAULT_LOCALE,
  };
};

/** Fetches the draft through the preview API and renders it. */
export const loadPreview = async (
  shapioUrl: string,
  request: PreviewRequest,
): Promise<{ html: string; title: string }> => {
  const client = createClient({ baseUrl: shapioUrl, token: request.token });
  const params = new URLSearchParams({
    locale: request.locale,
    richText: 'html',
    ...(request.modelKey === 'articles' ? { populate: 'author' } : {}),
  });
  const { data } = await client.request<DeliveryItem<Page | Article>>(
    `/api/preview/content/${encodeURIComponent(request.modelKey)}/${encodeURIComponent(request.entryId)}?${params.toString()}`,
  );
  const context = { locale: request.locale, strings: stringsFor(request.locale) };
  return {
    title: data.title,
    html: request.modelKey === 'pages' ? renderPage(data as Page) : renderArticle(data as Article, context),
  };
};
