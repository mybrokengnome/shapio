import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistentStorage } from '@/helpers/safeStorage';
import type { ListView } from '../constants';

type ListColumnsState = {
  /** Field IDs shown as columns, per model ID. A model without an entry uses its default columns. */
  byModel: Readonly<Record<string, readonly string[]>>;
  /** Table or cards, per model ID. A model without an entry shows the table. */
  viewByModel: Readonly<Record<string, ListView>>;
  setColumns: (modelId: string, fieldIds: readonly string[] | undefined) => void;
  setView: (modelId: string, view: ListView) => void;
};

/** A place's column choice and view (this browser only; a per-person convenience, not shared state). */
export const useListColumnsStore = create<ListColumnsState>()(
  persist(
    (set) => ({
      byModel: {},
      viewByModel: {},
      setColumns: (modelId, fieldIds) =>
        set((state) => {
          const { [modelId]: _previous, ...rest } = state.byModel;
          return { byModel: fieldIds ? { ...rest, [modelId]: fieldIds } : rest };
        }),
      setView: (modelId, view) =>
        set((state) => ({ viewByModel: { ...state.viewByModel, [modelId]: view } })),
    }),
    // Version 1 stored only `byModel`; the persisted state is merged over the defaults, so it still loads.
    { name: 'shapio.contentColumns', storage: persistentStorage, version: 1 },
  ),
);
