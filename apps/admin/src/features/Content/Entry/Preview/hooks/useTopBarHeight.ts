import { useEffect, useState } from 'react';

/** The document's top bar; the preview pane starts under it on lg and up so its actions stay in view. */
const TOP_BAR_SELECTOR = '[data-slot="entry-top-bar"]';

/** The top bar's current height in pixels (it wraps on narrow screens), while `enabled`. */
export const useTopBarHeight = (enabled: boolean): number => {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const bar = enabled ? document.querySelector(TOP_BAR_SELECTOR) : null;
    if (!bar) {
      return undefined;
    }
    const observer = new ResizeObserver(() => setHeight(bar.getBoundingClientRect().height));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [enabled]);
  return height;
};
