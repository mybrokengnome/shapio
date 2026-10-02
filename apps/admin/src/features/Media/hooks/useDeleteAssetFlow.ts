import { ShapioApiError, type MediaAsset } from '@shapio/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { hasErrorCode } from '@/api/errors';
import { useDeleteMediaAsset } from '@/api/media';
import { i18next } from '@/app/i18n';

const usageCountOf = (error: unknown): number => {
  const details =
    error instanceof ShapioApiError ? (error.details as { usageCount?: unknown } | undefined) : undefined;
  return typeof details?.usageCount === 'number' ? details.usageCount : 0;
};

/**
 * Delete, with the server's protection surfaced: a referenced asset answers 409 MEDIA_IN_USE. For an owner
 * the inline confirmation then hands over to a blocking "Delete anyway" dialog (which sends `force`); for
 * anyone else the inline confirmation stays open and explains why it can't be deleted.
 */
export const useDeleteAssetFlow = (
  asset: MediaAsset | undefined,
  isOwner: boolean,
  onDeleted: () => void,
) => {
  const remove = useDeleteMediaAsset();
  const [blocked, setBlocked] = useState<{ assetId: string; usageCount: number } | undefined>(undefined);
  const [forceOpen, setForceOpen] = useState(false);
  // Kept while the dialog animates out, so its text doesn't change.
  const [forceUsageCount, setForceUsageCount] = useState(0);
  const deleted = (target: MediaAsset) => {
    toast.success(i18next.t('media.delete.done', { name: target.filename }));
    onDeleted();
  };
  return {
    /** Set once a non-owner's delete was refused because content uses the file. */
    blockedUsageCount: blocked && blocked.assetId === asset?.id ? blocked.usageCount : undefined,
    /** The inline confirmation's action: rejects (and the popover shows why) unless it was handed over. */
    confirm: async () => {
      if (!asset) {
        return;
      }
      try {
        await remove.mutateAsync({ id: asset.id, force: false });
      } catch (error) {
        if (!hasErrorCode(error, 'MEDIA_IN_USE')) {
          throw error;
        }
        const usageCount = usageCountOf(error);
        if (!isOwner) {
          setBlocked({ assetId: asset.id, usageCount });
          throw error;
        }
        remove.reset();
        setForceUsageCount(usageCount);
        setForceOpen(true);
        return;
      }
      deleted(asset);
    },
    force: {
      open: forceOpen,
      usageCount: forceUsageCount,
      pending: remove.isPending,
      error: remove.error,
      onOpenChange: setForceOpen,
      confirm: () => {
        if (asset) {
          remove.mutate(
            { id: asset.id, force: true },
            {
              onSuccess: () => {
                setForceOpen(false);
                deleted(asset);
              },
            },
          );
        }
      },
    },
  };
};
