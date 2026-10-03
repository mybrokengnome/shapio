import { initVisualEditing } from '@shapio/visual';
import { useEffect, useState } from 'react';
import { publicShapioUrl } from '../../../lib/config';
import { loadDraft, parsePreviewUrl, type PreviewDraft } from '../../../lib/preview';
import { DEFAULT_LOCALE, type Locale } from '../../../lib/site';

export type PreviewState =
  | { status: 'loading'; locale: Locale }
  | { status: 'incomplete'; locale: Locale }
  | { status: 'failed'; locale: Locale; message: string }
  | { status: 'ready'; locale: Locale; draft: PreviewDraft };

/**
 * Reads the preview request from the URL once, drops the token from the address bar, and loads the draft.
 * Inside Shapio's preview pane, @shapio/visual turns on visual editing and re-loads the draft after each save
 * (the token stays in memory: the address bar no longer has it).
 */
export const usePreviewDraft = (): PreviewState => {
  const [state, setState] = useState<PreviewState>({ status: 'loading', locale: DEFAULT_LOCALE });
  useEffect(() => {
    const request = parsePreviewUrl(new URL(window.location.href));
    // The token must not linger in the address bar, history or a shared screenshot.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!request) {
      setState({ status: 'incomplete', locale: DEFAULT_LOCALE });
      return undefined;
    }
    let active = true;
    const load = async () => {
      try {
        const draft = await loadDraft(publicShapioUrl(), request);
        if (active) {
          setState({ status: 'ready', locale: request.locale, draft });
        }
      } catch (error) {
        if (active) {
          setState({
            status: 'failed',
            locale: request.locale,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void load();
    const stop = initVisualEditing({ origin: publicShapioUrl(), onRefresh: load });
    return () => {
      active = false;
      stop();
    };
  }, []);
  return state;
};
