import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session';

/**
 * Counts this screen's unsaved edits in the session store while `dirty`, so an ended session is resumed in
 * place (the page and its edits stay) instead of sending the person to Sign in.
 */
export const useRegisterUnsavedEdits = (dirty: boolean) => {
  useEffect(() => {
    if (!dirty) {
      return undefined;
    }
    const { addUnsavedEdits, removeUnsavedEdits } = useSessionStore.getState();
    addUnsavedEdits();
    return removeUnsavedEdits;
  }, [dirty]);
};
