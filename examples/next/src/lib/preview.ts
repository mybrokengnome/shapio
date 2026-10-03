import { createClient } from '@shapio/client';
import { DEFAULT_LOCALE, isLocale, type Locale } from './site';
import type { Article, DeliveryItem, Page } from './types';

/**
 * Preview: Shapio opens `/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}` (the
 * connection's preview URL template). `{modelKey}` is the model's route key (`pages`, `articles`). The token
 * sits in the fragment, so it never reaches a server log or a Referer header; it is a scoped, expiring preview
 * token, never an admin credential. The draft is read in the browser from `/api/preview/content/...` and
 * rendered with the same components as the published pages.
 */
export const PREVIEW_MODELS = ['pages', 'articles'] as const;

export type PreviewRequest = {
  token: string;
  modelKey: (typeof PREVIEW_MODELS)[number];
  entryId: string;
  locale: Locale;
};

export type PreviewDraft =
  | { modelKey: 'pages'; entry: Page; locale: Locale }
  | { modelKey: 'articles'; entry: Article; locale: Locale };

/** Reads the request from a preview URL; undefined when something is missing or unknown. */
export const parsePreviewUrl = (url: URL): PreviewRequest | undefined => {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = fragment.get('token') ?? url.searchParams.get('token');
  const modelKey = url.searchParams.get('model');
  const entryId = url.searchParams.get('id');
  const locale = url.searchParams.get('locale') ?? DEFAULT_LOCALE;
  if (!token || !entryId || !(PREVIEW_MODELS as readonly string[]).includes(modelKey ?? '')) {
    return undefined;
  }
  return {
    token,
    modelKey: modelKey as PreviewRequest['modelKey'],
    entryId,
    locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
  };
};

/** Fetches the draft through the preview API. */
export const loadDraft = async (shapioUrl: string, request: PreviewRequest): Promise<PreviewDraft> => {
  const client = createClient({ baseUrl: shapioUrl, token: request.token });
  const params = new URLSearchParams({
    locale: request.locale,
    ...(request.modelKey === 'articles' ? { populate: 'author' } : {}),
  });
  const { data } = await client.request<DeliveryItem<Page | Article>>(
    `/api/preview/content/${encodeURIComponent(request.modelKey)}/${encodeURIComponent(request.entryId)}?${params.toString()}`,
  );
  return request.modelKey === 'pages'
    ? { modelKey: 'pages', entry: data as Page, locale: request.locale }
    : { modelKey: 'articles', entry: data as Article, locale: request.locale };
};
