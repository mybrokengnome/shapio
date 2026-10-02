import { useCallback, useState } from 'react';

/** The assets ticked for bulk actions. */
export const useAssetSelection = () => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (id: string, checked: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      }),
    [],
  );
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, clear };
};
