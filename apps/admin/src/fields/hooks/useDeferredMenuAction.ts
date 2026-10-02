import { useCallback, useRef } from 'react';

/**
 * Runs a menu item's action after the menu has closed. A Radix menu holds focus while it is open and gives
 * it back to its trigger as it closes, so an action that moves focus (a new block, the cursor in rich text)
 * must run after that: `defer(action)` from the item's `onSelect`, and `onCloseAutoFocus` on the content.
 */
export const useDeferredMenuAction = () => {
  const pending = useRef<(() => void) | null>(null);
  const defer = useCallback((action: () => void) => {
    pending.current = action;
  }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    const action = pending.current;
    if (action) {
      pending.current = null;
      event.preventDefault();
      action();
    }
  }, []);
  return { defer, onCloseAutoFocus };
};
