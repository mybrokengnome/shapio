import type { MediaAsset } from '@shapio/client';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { useDeleteAssetFlow } from '../../hooks/useDeleteAssetFlow';

type DeleteActionProps = { asset: MediaAsset; onDeleted: () => void };

/**
 * "Delete file", confirmed inline. If content still uses the file, the confirmation says so; only an owner
 * can then delete it anyway, through a blocking dialog (it leaves that content pointing at a missing file).
 */
export const DeleteAction = ({ asset, onDeleted }: DeleteActionProps) => {
  const { t } = useTranslation();
  const { isOwner } = useMediaPermissions();
  const deletion = useDeleteAssetFlow(asset, isOwner, onDeleted);
  const blocked = deletion.blockedUsageCount;
  return (
    <>
      <InlineConfirm
        tone="danger"
        align="start"
        side="top"
        title={t('media.delete.title', { name: asset.filename })}
        description={
          blocked === undefined
            ? t('media.delete.description')
            : `${t('media.delete.inUseDescription', { count: blocked })} ${t('media.delete.onlyOwners')}`
        }
        confirmLabel={t('common.delete')}
        onConfirm={deletion.confirm}
        trigger={
          <Button variant="destructive-ghost">
            <Trash2 aria-hidden="true" />
            {t('media.delete.action')}
          </Button>
        }
      />
      <ConfirmDialog
        open={deletion.force.open}
        onOpenChange={deletion.force.onOpenChange}
        title={t('media.delete.inUseTitle')}
        description={`${t('media.delete.inUseDescription', { count: deletion.force.usageCount })} ${t(
          'media.delete.ownerMayForce',
        )}`}
        confirmLabel={t('media.delete.force')}
        destructive
        pending={deletion.force.pending}
        error={deletion.force.error}
        onConfirm={deletion.force.confirm}
      />
    </>
  );
};
