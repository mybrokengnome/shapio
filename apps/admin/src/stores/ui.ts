import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistentStorage } from '@/helpers/safeStorage';

type UiState = {
  /** Desktop sidebar expanded (true) or collapsed to icons. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    { name: 'shapio.ui', storage: persistentStorage, version: 1 },
  ),
);
