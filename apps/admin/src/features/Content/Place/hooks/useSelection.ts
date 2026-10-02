import { useState } from 'react';

/** The entries ticked for bulk actions (kept across pages until cleared). */
export const useSelection = () => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const changeSelection = (ids: readonly string[], checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  const replaceSelection = (ids: readonly string[]) => setSelected(new Set(ids));
  return { selected, changeSelection, replaceSelection };
};
