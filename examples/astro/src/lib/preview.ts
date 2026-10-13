import { createClient } from '@shapio/client';
import { renderArticle, renderPage } from './render.js';
import { DEFAULT_LOCALE, stringsFor } from './site.js';
import type { Article, DeliveryItem, Page } from './types.js';

/**
 * Preview: Shapio opens `/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}` (the
 * connection's preview URL template). `{modelKey}` is the model's route key, as in the delivery and preview
 * APIs: the plural API ID of a collection (`pages`, `articles`), nested under its parent's for a type that
 * extends another (`articles/guides`). The token sits in the fragment, so it never reaches a server log or a
 * Referer header; it is a scoped, expiring preview token, never an admin credential. The draft is read from
 * `/api/preview/content/...` and rendered with the same functions as the published pages.
 */
export const PREVIEW_MODELS = ['pages', 'articles'] as const;

/** One API ID: what each segment of a route key must be. */
const API_ID = /^[_A-Za-z][_0-9A-Za-z]*$/;

export type PreviewRequest = {
  token: string;
  /** The route key from the URL: one of PREVIEW_MODELS, or a type nested under one (`articles/guides`). */
  modelKey: string;
  /** The family root the draft renders as: a type that extends Article renders as an article. */
  family: (typeof PREVIEW_MODELS)[number];
  entryId: string;
  locale: string;
};

/** The allowlisted family of a route key, or undefined for anything else. */
const familyOf = (modelKey: string): PreviewRequest['family'] | undefined => {
  const segments = modelKey.split('/');
  const root = segments[0] ?? '';
  return segments.every((segment) => API_ID.test(segment)) &&
    (PREVIEW_MODELS as readonly string[]).includes(root)
    ? (root as PreviewRequest['family'])
    : undefined;
};

/** Reads the request from a preview URL; undefined when something is missing or unknown. */
export const parsePreviewUrl = (url: URL): PreviewRequest | undefined => {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get('token') ?? url.searchParams.get('token');
  const modelKey = url.searchParams.get('model') ?? '';
  const entryId = url.searchParams.get('id');
  const family = familyOf(modelKey);
  if (!token || !entryId || !family) {
    return undefined;
  }
  return {
    token,
    modelKey,
    family,
    entryId,
    locale: url.searchParams.get('locale') ?? DEFAULT_LOCALE,
  };
};

/** The preview API path of a route key: each segment encoded, the `/` between them kept. */
const previewPath = (modelKey: string, entryId: string) =>
  `/api/preview/content/${modelKey.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(entryId)}`;

/** Fetches the draft through the preview API and renders it. */
export const loadPreview = async (
  shapioUrl: string,
  request: PreviewRequest,
): Promise<{ html: string; title: string }> => {
  const client = createClient({ baseUrl: shapioUrl, token: request.token });
  const params = new URLSearchParams({
    locale: request.locale,
    richText: 'html',
    ...(request.family === 'articles' ? { populate: 'author' } : {}),
  });
  const { data } = await client.request<DeliveryItem<Page | Article>>(
    `${previewPath(request.modelKey, request.entryId)}?${params.toString()}`,
  );
  const context = { locale: request.locale, strings: stringsFor(request.locale) };
  return {
    title: data.title,
    html: request.family === 'pages' ? renderPage(data as Page) : renderArticle(data as Article, context),
  };
};
