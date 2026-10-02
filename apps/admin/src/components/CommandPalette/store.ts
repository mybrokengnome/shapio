import { create } from 'zustand';
import type { PaletteItem, RegisteredGroup } from './types';

type Registration = { group: RegisteredGroup; items: readonly PaletteItem[] };

type PaletteState = {
  open: boolean;
  /** What had focus when the palette opened; it gets focus back when the palette closes. */
  returnFocus: HTMLElement | null;
  setOpen: (open: boolean) => void;
  /** Items registered by mounted screens and the shell, by registration ID. */
  registrations: ReadonlyMap<string, Registration>;
  register: (id: string, registration: Registration) => void;
  unregister: (id: string) => void;
};

/** Whether the palette is open and what the mounted screens offer in it (client-only state). */
export const usePaletteStore = create<PaletteState>()((set) => ({
  open: false,
  returnFocus: null,
  setOpen: (open) =>
    set((state) =>
      open && !state.open
        ? { open, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null }
        : { open },
    ),
  registrations: new Map(),
  register: (id, registration) =>
    set((state) => ({ registrations: new Map(state.registrations).set(id, registration) })),
  unregister: (id) =>
    set((state) => {
      const registrations = new Map(state.registrations);
      registrations.delete(id);
      return { registrations };
    }),
}));
