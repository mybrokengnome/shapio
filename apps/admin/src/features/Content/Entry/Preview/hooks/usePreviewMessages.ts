import type { VisualFocusMessage } from '@shapio/visual';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PREVIEW_READY_TIMEOUT_MS } from '@/constants/publishing';
import { acceptSiteMessage } from '../helpers/previewMessages';

type FrameState = { url: string | undefined; ready: boolean; missing: boolean };

/**
 * Listens to the preview frame: `shapio:ready` (the site runs @shapio/visual) and `shapio:focus` (a click on
 * a field). Only the frame's own window on the preview origin is heard. When the page has loaded and no ready
 * message arrives in time, `missing` is set (the pane explains how to add the SDK).
 */
export const usePreviewMessages = (
  frameRef: RefObject<HTMLIFrameElement | null>,
  url: string | undefined,
  origin: string | undefined,
  onFocus: (message: VisualFocusMessage) => void,
) => {
  const [state, setState] = useState<FrameState>({ url: undefined, ready: false, missing: false });
  const latestFocus = useRef(onFocus);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    latestFocus.current = onFocus;
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = acceptSiteMessage(event, frameRef.current?.contentWindow, origin);
      if (message?.type === 'shapio:ready') {
        clearTimeout(timer.current);
        setState({ url, ready: true, missing: false });
      } else if (message?.type === 'shapio:focus') {
        latestFocus.current(message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer.current);
    };
  }, [frameRef, url, origin]);

  /** The frame's `load`: start waiting for the site's ready message. */
  const onFrameLoad = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        setState((current) =>
          current.url === url && current.ready ? current : { url, ready: false, missing: true },
        ),
      PREVIEW_READY_TIMEOUT_MS,
    );
  }, [url]);

  const current = state.url === url ? state : { url, ready: false, missing: false };
  return { ready: current.ready, missing: current.missing, onFrameLoad };
};
