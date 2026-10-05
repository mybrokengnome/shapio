import { useCallback, useState } from 'react';
import { useMediaQuery, XL_QUERY } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/stores/ui';
import type { DrawerFocus } from '../SettingsDrawer';

/**
 * The settings drawer's state: open, where it opened, which property rows are expanded. On wide screens
 * (`xl`, where it sits beside the document) it is open unless the person closed it, and every open or close
 * there is remembered per browser; narrower, it overlays the document and starts closed (a window narrowed
 * while it is open keeps it open). `automatic` is true
 * while it is open only because of that default, so it doesn't take focus from the document.
 */
export const useSettingsDrawer = () => {
  const wide = useMediaQuery(XL_QUERY);
  const remembered = useUiStore((state) => state.entrySettingsOpen);
  const remember = useUiStore((state) => state.setEntrySettingsOpen);
  const [narrowOpen, setNarrowOpen] = useState(false);
  // Closed for the preview without changing the remembered choice; any open or close clears it.
  const [hidden, setHidden] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focus, setFocus] = useState<DrawerFocus>({ section: 'status' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const open = wide ? remembered && !hidden : narrowOpen;
  // Narrowing the window (a resized window, a rotated tablet) keeps the drawer as it was; only a narrow
  // start is closed. Adjusted while rendering, React's pattern for state that follows a changed input.
  const [wasWide, setWasWide] = useState(wide);
  if (wasWide !== wide) {
    setWasWide(wide);
    if (!wide) {
      setNarrowOpen(remembered && !hidden);
    }
  }

  // Stable, and reads the viewport when called: Radix can keep an `onOpenChange` from before a resize.
  const setOpen = useCallback(
    (next: boolean) => {
      setTouched(true);
      setHidden(false);
      if (window.matchMedia(XL_QUERY).matches) {
        remember(next);
      } else {
        setNarrowOpen(next);
      }
    },
    [remember],
  );
  const openAt = useCallback(
    (next: DrawerFocus) => {
      setFocus(next);
      if (next.property) {
        const property = next.property;
        setExpanded((current) => new Set([...current, property]));
      }
      setOpen(true);
    },
    [setOpen],
  );
  const toggleProperty = useCallback(
    (apiKey: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(apiKey)) {
          next.delete(apiKey);
        } else {
          next.add(apiKey);
        }
        return next;
      }),
    [],
  );
  return {
    open,
    automatic: open && !touched,
    setOpen,
    focus,
    expanded,
    openAt,
    toggle: useCallback(() => setOpen(!open), [setOpen, open]),
    /** Makes room for the preview: closes the drawer without changing the remembered choice. */
    hideForPreview: useCallback(() => setHidden(true), []),
    toggleProperty,
  };
};
