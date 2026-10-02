import { useState } from 'react';
import type { SaveKind, SaveOutcome } from './useEntrySaver';

/**
 * Opening the pre-flight: unsaved changes are autosaved first (no revision, nothing validated beyond the
 * format), so the checks are about what is on screen. A conflict closes it again (the banner takes over).
 */
export const usePreflightFlow = (save: (kind: SaveKind) => Promise<SaveOutcome>) => {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const start = async () => {
    setReady(false);
    setOpen(true);
    const outcome = await save('autosave');
    if (outcome === 'conflict') {
      setOpen(false);
      return;
    }
    setReady(true);
  };
  return {
    open,
    ready,
    start: () => void start(),
    setOpen: (next: boolean) => (next ? void start() : setOpen(false)),
  };
};
