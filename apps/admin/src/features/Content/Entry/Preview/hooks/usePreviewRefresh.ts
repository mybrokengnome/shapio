import { useEffect, useRef } from 'react';
import { PREVIEW_REFRESH_DEBOUNCE_MS } from '@/constants/publishing';
import type { SaveState } from '../../hooks/useEntrySaver';

/**
 * Re-renders the preview after the draft is saved (autosave, Save, Publish): when a save settles, `refresh`
 * runs once after a short quiet period, so a burst of saves refreshes the frame once.
 */
export const usePreviewRefresh = (status: SaveState['status'], enabled: boolean, refresh: () => void) => {
  const previous = useRef(status);
  const latestRefresh = useRef(refresh);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    latestRefresh.current = refresh;
  });
  useEffect(() => {
    const settled = previous.current === 'saving' && status === 'saved';
    previous.current = status;
    if (enabled && settled) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latestRefresh.current(), PREVIEW_REFRESH_DEBOUNCE_MS);
    }
  }, [status, enabled]);
  useEffect(() => () => clearTimeout(timer.current), []);
};
