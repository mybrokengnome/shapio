import { useEffect, useRef } from 'react';

/**
 * A value that follows another one (an API ID its label, a key its name) until the user types one of their
 * own: it is replaced only while it is empty or still what `derive` made of the previous source. (React Hook
 * Form's dirty state cannot tell: it marks the derived value dirty as soon as the source changes again, so
 * typing the source key by key stopped the value after its first letter.)
 */
export const useValueFromSource = (
  source: string,
  getValue: () => string,
  setValue: (value: string) => void,
  derive: (source: string) => string,
  /** False while the value is fixed (an existing role's key): it never follows then. */
  enabled = true,
) => {
  const previousSource = useRef(source);
  useEffect(() => {
    if (!enabled) {
      previousSource.current = source;
      return;
    }
    const current = getValue();
    if (current === '' || current === derive(previousSource.current)) {
      setValue(derive(source));
    }
    previousSource.current = source;
  }, [source, getValue, setValue, derive, enabled]);
};
