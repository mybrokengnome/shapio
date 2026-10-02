import { useCallback } from 'react';
import { usePaletteStore } from '../store';

/** Opens the palette (the sidebar's search button; on phones there is no ⌘K). */
export const useOpenCommandPalette = () => {
  const setOpen = usePaletteStore((state) => state.setOpen);
  return useCallback(() => setOpen(true), [setOpen]);
};
