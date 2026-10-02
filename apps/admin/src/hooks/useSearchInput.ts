import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';

const SEARCH_DEBOUNCE_MS = 300;

/** A search box bound to a URL value: typing updates the URL once the user pauses. */
export const useSearchInput = (
  urlValue: string | undefined,
  onCommit: (value: string | undefined) => void,
) => {
  const [text, setText] = useState(urlValue ?? '');
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const next = debounced.trim() || undefined;
    if (next !== urlValue) {
      commit.current(next);
    }
    // Only when the debounced text settles; the URL value is the comparison, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return { text, setText };
};
