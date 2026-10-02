import { useEffect, useRef } from 'react';

/**
 * Mod+S runs `onSave` (instead of the browser's "save page") while `enabled`. The entry form saves with it,
 * the model builder opens its review.
 */
export const useSaveShortcut = (onSave: () => void, enabled: boolean) => {
  const latest = useRef(onSave);
  useEffect(() => {
    latest.current = onSave;
  });
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
};
