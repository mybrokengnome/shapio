import { useCallback, useState } from 'react';
import type { DrawerFocus } from '../SettingsDrawer';

/** The settings drawer's state: open, where it opened, which property rows are expanded. */
export const useSettingsDrawer = () => {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<DrawerFocus>({ section: 'status' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const openAt = useCallback((next: DrawerFocus) => {
    setFocus(next);
    if (next.property) {
      const property = next.property;
      setExpanded((current) => new Set([...current, property]));
    }
    setOpen(true);
  }, []);
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
    setOpen,
    focus,
    expanded,
    openAt,
    toggle: useCallback(() => setOpen((current) => !current), []),
    toggleProperty,
  };
};
