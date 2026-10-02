import { useSyncExternalStore } from 'react';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const getSnapshot = () => window.matchMedia(DARK_QUERY).matches;

/** True while the OS asks for dark mode; re-renders when that changes. */
export const useSystemPrefersDark = () => useSyncExternalStore(subscribe, getSnapshot, () => false);
