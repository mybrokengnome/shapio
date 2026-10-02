import { useState } from 'react';

/**
 * The highlighted option of a listbox driven by `aria-activedescendant` (focus stays on the combobox).
 * Remembered by id, so it survives new results and clears itself when its option goes away.
 */
export const useActiveOption = (ids: readonly string[]) => {
  const [rememberedId, setActiveId] = useState<string | undefined>();
  const activeId = rememberedId !== undefined && ids.includes(rememberedId) ? rememberedId : undefined;
  /** ↓ from nothing goes to the first option, ↑ to the last; both stop at the ends. */
  const move = (delta: 1 | -1) => {
    if (ids.length === 0) {
      return;
    }
    const index = activeId === undefined ? -1 : ids.indexOf(activeId);
    const next = index === -1 ? (delta === 1 ? 0 : ids.length - 1) : index + delta;
    setActiveId(ids[Math.min(Math.max(next, 0), ids.length - 1)]);
  };
  return {
    activeId,
    setActiveId,
    move,
    first: () => setActiveId(ids[0]),
    last: () => setActiveId(ids.at(-1)),
  };
};
