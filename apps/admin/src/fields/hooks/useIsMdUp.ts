import { useSyncExternalStore } from 'react';

// Tailwind's `md` breakpoint (48rem).
const MD_QUERY = '(min-width: 48rem)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(MD_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const getSnapshot = () => window.matchMedia(MD_QUERY).matches;

/** True from the `md` breakpoint up: pickers anchor a popover to their field there, and use a bottom sheet below. */
export const useIsMdUp = () => useSyncExternalStore(subscribe, getSnapshot, () => true);
