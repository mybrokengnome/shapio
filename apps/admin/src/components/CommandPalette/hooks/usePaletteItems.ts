import { useEffect, useId } from 'react';
import { usePaletteStore } from '../store';
import type { PaletteItem, RegisteredGroup } from '../types';

/**
 * Offers `items` in the palette while the calling component is mounted. Pass a memoized array: a new
 * array re-registers.
 */
export const usePaletteItems = (group: RegisteredGroup, items: readonly PaletteItem[]) => {
  const id = useId();
  const register = usePaletteStore((state) => state.register);
  const unregister = usePaletteStore((state) => state.unregister);
  useEffect(() => {
    register(id, { group, items });
    return () => unregister(id);
  }, [id, group, items, register, unregister]);
};
