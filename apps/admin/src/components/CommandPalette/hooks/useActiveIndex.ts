import { useCallback, useState, type KeyboardEvent } from 'react';

/**
 * The highlighted row of a list driven from a text input: ↑/↓ move (wrapping), and the highlight returns
 * to the first row whenever `resetKey` changes (new text, new results).
 */
export const useActiveIndex = (count: number, resetKey: string) => {
  const [state, setState] = useState({ key: resetKey, index: 0 });
  const current = state.key === resetKey ? state.index : 0;
  const activeIndex = count === 0 ? -1 : Math.min(current, count - 1);
  const setActiveIndex = useCallback((index: number) => setState({ key: resetKey, index }), [resetKey]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (count === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
      }
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((Math.max(activeIndex, 0) + step + count) % count);
    },
    [count, activeIndex, setActiveIndex],
  );
  return { activeIndex, setActiveIndex, onKeyDown };
};
