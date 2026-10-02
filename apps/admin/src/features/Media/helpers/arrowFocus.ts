import type { KeyboardEvent } from 'react';

/**
 * Up/Down (and Home/End) move focus between the enabled buttons inside `event.currentTarget`, for short
 * pick lists where Tab alone would be slow.
 */
export const moveFocusWithArrows = (event: KeyboardEvent<HTMLElement>) => {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) {
    return;
  }
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (buttons.length === 0) {
    return;
  }
  event.preventDefault();
  const index = buttons.findIndex((button) => button === document.activeElement);
  const last = buttons.length - 1;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown'
          ? Math.min(index + 1, last)
          : Math.max(index - 1, 0);
  buttons[next]?.focus();
};
