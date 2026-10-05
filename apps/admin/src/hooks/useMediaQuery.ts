import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `xl` (80rem): the entry's Settings panel sits beside the document from here up. */
export const XL_QUERY = '(min-width: 80rem)';

/**
 * Whether a media query matches, kept current as the viewport changes. `serverValue` is what it reports
 * where there is no `window` (tests without a DOM).
 */
export const useMediaQuery = (query: string, serverValue = false): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
};
