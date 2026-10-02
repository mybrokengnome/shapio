import { create } from 'zustand';
import { useSessionStore } from '@/stores/session';

type ExplorerTokenState = {
  /** A pasted API token: in memory only (never persisted, never in a URL), gone on reload or sign-out. */
  token: string;
  setToken: (token: string) => void;
};

export const useExplorerTokenStore = create<ExplorerTokenState>()((set) => ({
  token: '',
  setToken: (token) => set({ token }),
}));

// The admin session ended or changed (its CSRF token is cleared): forget the pasted token too.
useSessionStore.subscribe((state, previous) => {
  if (previous.csrfToken !== undefined && state.csrfToken === undefined) {
    useExplorerTokenStore.setState({ token: '' });
  }
});
