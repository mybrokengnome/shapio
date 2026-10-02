import { useState } from 'react';
import { toast } from 'sonner';
import { useMoveMediaAssets } from '@/api/media';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';

/** The move target while a move runs: a folder ID, or null for "no folder". */
type MoveTarget = string | null;

/** Moves assets into a folder (or out of every folder) and reports it; `onMoved` runs on success. */
export const useMoveToFolder = (assetIds: readonly string[], onMoved: () => void) => {
  const move = useMoveMediaAssets();
  const [target, setTarget] = useState<MoveTarget | undefined>(undefined);
  return {
    /** The folder being moved into while the request runs. */
    target: move.isPending ? target : undefined,
    pending: move.isPending,
    error: move.error,
    reset: move.reset,
    moveTo: async (folderId: MoveTarget) => {
      setTarget(folderId);
      const result = await settle(move.mutateAsync({ assetIds: [...assetIds], folderId }));
      if (result.ok) {
        toast.success(i18next.t('media.move.done', { count: result.value.moved.length }));
        onMoved();
      }
    },
  };
};
