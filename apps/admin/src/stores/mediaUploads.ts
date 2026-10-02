import type { MediaVisibility } from '@shapio/client';
import { create } from 'zustand';

export type UploadStatus = 'uploading' | 'confirming' | 'done' | 'failed';

export type UploadItem = {
  id: string;
  file: File;
  folderId: string | null;
  visibility: MediaVisibility;
  /** Set when the upload replaces this asset's file. */
  replaceAssetId: string | undefined;
  status: UploadStatus;
  /** 0 to 1 while the bytes are sent. */
  progress: number;
  error: unknown;
  assetId: string | undefined;
};

type MediaUploadsState = {
  items: UploadItem[];
  add: (item: UploadItem) => void;
  update: (id: string, patch: Partial<UploadItem>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
};

/** Uploads in flight and recently finished (client-only; kept while the admin is open, not persisted). */
export const useMediaUploadsStore = create<MediaUploadsState>()((set) => ({
  items: [],
  add: (item) => set((state) => ({ items: [...state.items, item] })),
  update: (id, patch) =>
    set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clearFinished: () => set((state) => ({ items: state.items.filter((item) => item.status !== 'done') })),
}));
