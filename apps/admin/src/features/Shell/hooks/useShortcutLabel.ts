import { useMemo } from 'react';

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export const useShortcutLabel = (key: string) =>
  useMemo(() => {
    const platform = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(platform) ? `⌘${key}` : `Ctrl ${key}`;
  }, [key]);
