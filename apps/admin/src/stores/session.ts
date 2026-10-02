import { create } from 'zustand';

type SessionState = {
  /** CSRF token bound to the current admin session; fetched lazily, cleared whenever the session changes. */
  csrfToken: string | undefined;
  setCsrfToken: (token: string | undefined) => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  csrfToken: undefined,
  setCsrfToken: (csrfToken) => set({ csrfToken }),
}));
