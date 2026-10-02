import { useEffect, useRef } from 'react';
import type { EntryFormStore } from '@/fields/form/store';
import { AUTOSAVE_DELAY_MS } from '../../constants';
import type { SaveKind, SaveOutcome } from './useEntrySaver';

/**
 * Autosave: a short while after the last change, the draft is saved with the API's `autosave` flag (no
 * revision, `required` not enforced), so work survives a closed tab without filling the history.
 */
export const useAutosave = (
  store: EntryFormStore,
  enabled: boolean,
  save: (kind: SaveKind) => Promise<SaveOutcome>,
) => {
  // The latest save function, so re-renders never restart (and so cancel) a pending autosave.
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.values === previous.values) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void latestSave.current('autosave'), AUTOSAVE_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [store, enabled]);
};
