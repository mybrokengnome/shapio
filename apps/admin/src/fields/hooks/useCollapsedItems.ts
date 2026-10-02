import { useCallback, useState } from 'react';

/** Which list items are collapsed, by client key. New items are expanded; `startCollapsed` applies to loaded ones. */
export const useCollapsedItems = (initialKeys: readonly string[], startCollapsed: boolean) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(startCollapsed ? initialKeys : []),
  );
  const toggle = useCallback(
    (key: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      }),
    [],
  );
  const setAll = useCallback(
    (keys: readonly string[], value: boolean) => setCollapsed(new Set(value ? keys : [])),
    [],
  );
  return { collapsed, toggle, setAll };
};
