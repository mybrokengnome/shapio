import { useEffect, useRef } from 'react';

/** After an item is added, moves focus to its header so keyboard users land on what they created. */
export const useFocusNewItem = (keys: readonly string[], domId: (key: string) => string) => {
  const previous = useRef(keys);
  useEffect(() => {
    const added = keys.find((key) => !previous.current.includes(key));
    previous.current = keys;
    if (added && keys.length > 0) {
      document.getElementById(domId(added))?.querySelector<HTMLElement>('button[aria-expanded]')?.focus();
    }
  }, [keys, domId]);
};
