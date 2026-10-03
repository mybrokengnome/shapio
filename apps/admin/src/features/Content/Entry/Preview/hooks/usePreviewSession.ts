import { useEffect, useState } from 'react';
import { openPreview, revokePreviewToken } from '@/api/preview';
import { PREVIEW_TOKEN_REFRESH_MARGIN_MS } from '@/constants/publishing';
import { logError } from '@/helpers/reportError';

type PreviewSessionInput = {
  modelKey: string;
  entryId: string;
  locale: string | null;
  connectionId: string | undefined;
};

export type PreviewSession =
  | { status: 'loading' }
  | { status: 'ready'; url: string | null }
  | { status: 'error'; error: unknown; retry: () => void };

/** Never schedule a refresh sooner than this, whatever the token's expiry says. */
const MIN_REFRESH_DELAY_MS = 30_000;

const release = (id: string) => {
  revokePreviewToken(id).catch((error: unknown) => logError(error, 'preview.revokeToken'));
};

/**
 * A preview token for the open entry while `enabled`: minted on open, replaced shortly before its hour is up
 * (the replaced token is revoked), and revoked when the preview closes or the entry, locale or connection
 * changes. Returns the URL the site opens it on.
 */
export const usePreviewSession = (input: PreviewSessionInput, enabled: boolean): PreviewSession => {
  const { modelKey, entryId, locale, connectionId } = input;
  const key = [modelKey, entryId, locale ?? '', connectionId ?? '', enabled].join('|');
  // The state belongs to one key: a stale key reads as loading, so nothing is set during render or effects.
  const [state, setState] = useState<{ key: string; session: PreviewSession } | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tokenId: string | undefined;
    const mint = async () => {
      try {
        const opened = await openPreview({
          modelKey,
          entryId,
          ...(locale ? { locale } : {}),
          ...(connectionId ? { connectionId } : {}),
        });
        if (cancelled) {
          release(opened.id);
          return;
        }
        if (tokenId) {
          release(tokenId);
        }
        tokenId = opened.id;
        setState({ key, session: { status: 'ready', url: opened.url } });
        const delay = Date.parse(opened.expiresAt) - Date.now() - PREVIEW_TOKEN_REFRESH_MARGIN_MS;
        timer = setTimeout(() => void mint(), Math.max(MIN_REFRESH_DELAY_MS, delay));
      } catch (error) {
        if (!cancelled) {
          logError(error, 'preview.open');
          setState({
            key,
            session: { status: 'error', error, retry: () => setAttempt((count) => count + 1) },
          });
        }
      }
    };
    void mint();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (tokenId) {
        release(tokenId);
      }
    };
  }, [enabled, key, modelKey, entryId, locale, connectionId, attempt]);

  return state?.key === key ? state.session : { status: 'loading' };
};
