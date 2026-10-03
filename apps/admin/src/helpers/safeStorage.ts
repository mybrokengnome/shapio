import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * localStorage that never throws: it is unavailable in private windows, with blocked site data, or when
 * full. Persisted state is a convenience (theme, sidebar), so failures fall back to in-memory defaults.
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Not persisted this time; the in-memory store still holds the value.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing to remove when storage is unavailable.
    }
  },
};

export const persistentStorage = createJSONStorage(() => safeLocalStorage);
