import { create } from 'zustand';

type SessionState = {
  /** CSRF token bound to the current admin session; fetched lazily, cleared whenever the session changes. */
  csrfToken: string | undefined;
  setCsrfToken: (token: string | undefined) => void;
  /**
   * How many mounted screens hold unsaved edits (each `UnsavedChangesGuard` or discard guard while it would
   * ask). While any do, an ended session is resumed in place instead of leaving for Sign in.
   */
  unsavedEdits: number;
  addUnsavedEdits: () => void;
  removeUnsavedEdits: () => void;
  /** The session ended over unsaved edits: the page stays and asks for the password in place. */
  signInRequired: boolean;
  requireSignIn: () => void;
  /** Bumped each time the session is resumed in place, so saves that failed with a 401 run again. */
  resumed: number;
  resume: () => void;
  /** Forgets a pending in-place sign-in (signed out, or a new session started from the sign-in page). */
  clearSignInRequired: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  csrfToken: undefined,
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  unsavedEdits: 0,
  addUnsavedEdits: () => set((state) => ({ unsavedEdits: state.unsavedEdits + 1 })),
  removeUnsavedEdits: () => set((state) => ({ unsavedEdits: Math.max(0, state.unsavedEdits - 1) })),
  signInRequired: false,
  requireSignIn: () => set({ signInRequired: true }),
  resumed: 0,
  resume: () => set((state) => ({ signInRequired: false, resumed: state.resumed + 1 })),
  clearSignInRequired: () => set({ signInRequired: false }),
}));

/** Whether some screen holds unsaved edits right now (for code outside React, like the query cache). */
export const hasUnsavedEdits = () => useSessionStore.getState().unsavedEdits > 0;
