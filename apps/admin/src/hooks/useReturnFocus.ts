import { useCallback, useRef } from 'react';

type AutoFocusHandler = (event: Event) => void;

/**
 * The element to return to. A menu item disappears with its menu, so a dialog opened from a menu returns
 * to the button that opened the menu (the element whose `aria-controls` names the menu).
 */
const openerOf = (active: Element | null): HTMLElement | null => {
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null;
  }
  const menu = active.closest('[role="menu"]');
  const menuButton = menu?.id ? document.querySelector(`[aria-controls="${CSS.escape(menu.id)}"]`) : null;
  return menuButton instanceof HTMLElement ? menuButton : active;
};

/**
 * Returns focus to whatever had it when a dialog opened, once it closes. Radix only returns focus to its
 * own Trigger, so dialogs opened another way (state, the URL, a picker callback) would leave focus on the
 * page body. Compose the returned handlers onto Radix's `onOpenAutoFocus`/`onCloseAutoFocus`; a caller's
 * own handler runs first and can still take over with `event.preventDefault()`.
 *
 * Radix skips `onOpenAutoFocus` when focus is already inside the dialog, so controls in dialogs must not
 * use `autoFocus`: Radix focuses the first control itself (or the caller's `onOpenAutoFocus` chooses one).
 */
export const useReturnFocus = (onOpenAutoFocus?: AutoFocusHandler, onCloseAutoFocus?: AutoFocusHandler) => {
  const returnTo = useRef<HTMLElement | null>(null);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      // Runs before Radix moves focus into the dialog: the active element is still the opener.
      returnTo.current = openerOf(document.activeElement);
      onOpenAutoFocus?.(event);
    },
    [onOpenAutoFocus],
  );
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = returnTo.current;
      returnTo.current = null;
      if (event.defaultPrevented || !target?.isConnected) {
        return;
      }
      target.focus({ preventScroll: true });
      if (document.activeElement === target) {
        event.preventDefault();
      }
    },
    [onCloseAutoFocus],
  );
  return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus };
};
