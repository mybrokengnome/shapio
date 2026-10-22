import { useCallback } from 'react';
import { TOP_BAR_SELECTOR } from '../Preview/hooks/useTopBarHeight';

/**
 * A ref for the element around the document's fields: it keeps `--entry-top-bar-h` on that element at the
 * top bar's height (the bar wraps on narrow screens), so sticky field chrome (a rich text toolbar) sits under
 * the bar. Written to the element directly, so a resize never re-renders the entry.
 */
export const useTopBarOffsetRef = () =>
  useCallback((element: HTMLElement | null) => {
    const bar = element ? document.querySelector(TOP_BAR_SELECTOR) : null;
    if (!element || !bar) {
      return undefined;
    }
    const observer = new ResizeObserver(() =>
      element.style.setProperty('--entry-top-bar-h', `${bar.getBoundingClientRect().height}px`),
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
